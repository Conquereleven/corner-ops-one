-- CornerOps One v0.2.1 acceptance — event authenticity, permission-change audit, telemetry identity
--
-- Findings (Codex audit 2):
-- * Any authenticated member could INSERT domain_events (only actor/org/location
--   were checked), so business events could be fabricated, and processed_at /
--   attempts could be pre-set to hide them from a future outbox consumer.
-- * UPDATEs on membership_locations (allowed by the write policy) were not audited.
-- * record_channel_activity treated a client session without an identity as "system".
--
-- After this migration:
-- * Clients cannot insert events. Events come only from validated operations:
--   the definer functions (orders, inventory, shortfalls), server/system
--   connections (ingestion, simulator, demo reset), and the configuration
--   triggers below, which derive the event from the actual row change.
-- * Every event insert has its processing state reset and, when a user is
--   acting, its actor pinned to that user.
-- * Location grants cannot be updated by clients; every grant/revoke/change is
--   audited with actor, membership and complete before/after state.

begin;

-- ---------------------------------------------------------------------------
-- Events: no client inserts; trusted columns forced on every insert

drop policy if exists domain_events_insert on public.domain_events;
revoke insert, update, delete on public.domain_events from authenticated, anon;

create or replace function private.normalize_domain_event()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.processed_at := null;
  new.attempts := 0;
  new.last_error := null;
  new.created_at := now();
  if auth.uid() is not null then
    new.actor_user_id := auth.uid();
    new.actor_label := 'user';
  end if;
  return new;
end;
$$;

create trigger domain_events_normalize
  before insert on public.domain_events
  for each row execute function private.normalize_domain_event();

-- Configuration events derived from the row change itself.
create or replace function private.emit_config_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_after jsonb;
  v_org text := v_row ->> 'organization_id';
  v_location text := v_row ->> 'location_id';
  v_type text;
  v_aggregate_type text;
  v_aggregate_id text := v_row ->> 'id';
  v_payload jsonb;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
     and coalesce(current_setting('cornerops.audit_suspended', true), '') = 'on' then
    return null;
  end if;
  select d.after_data into v_after from private.audit_diff(v_old, v_new, array['popularity', 'last_sync_at', 'error_count', 'latency_ms', 'message']) d;
  if tg_op = 'UPDATE' and v_after = '{}'::jsonb then
    return null;
  end if;

  case tg_table_name
    when 'menu_items' then
      v_aggregate_type := 'menu_item';
      v_type := case when v_after ? 'isAvailable' then 'menu.availability_changed' else 'menu.item_updated' end;
      v_payload := jsonb_build_object('name', v_row ->> 'name', 'sku', v_row ->> 'sku', 'changes', v_after - 'foodCost');
    when 'channel_connections' then
      if tg_op <> 'UPDATE' or not (v_after ? 'status') then return null; end if;
      v_aggregate_type := 'channel_connection';
      v_type := 'channel.' || (v_new ->> 'status');
      v_payload := jsonb_build_object('channel', v_row ->> 'channel_id', 'from', v_old ->> 'status', 'to', v_new ->> 'status', 'mode', v_row ->> 'mode');
    when 'locations' then
      v_aggregate_type := 'location';
      v_location := v_row ->> 'id';
      v_type := 'location.updated';
      v_payload := jsonb_build_object('name', v_row ->> 'name') || case when tg_op = 'INSERT' then '{"created": true}'::jsonb else jsonb_build_object('changes', v_after) end;
    when 'organization_settings' then
      v_aggregate_type := 'organization';
      v_aggregate_id := v_row ->> 'organization_id';
      v_type := 'settings.updated';
      v_payload := jsonb_build_object('sections', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(v_after) k));
    when 'organization_memberships' then
      v_aggregate_type := 'membership';
      if tg_op = 'INSERT' and v_new ->> 'status' = 'invited' then
        v_type := 'membership.invited';
        v_payload := jsonb_build_object('email', v_new ->> 'invited_email', 'role', v_new ->> 'role');
      else
        v_type := 'membership.updated';
        v_payload := jsonb_build_object('operation', lower(tg_op), 'role', v_row ->> 'role', 'status', v_row ->> 'status', 'changes', v_after);
      end if;
    when 'menu_channel_mappings' then
      if tg_op <> 'UPDATE' or v_new ->> 'status' <> 'pending' or v_old ->> 'status' = 'pending' then return null; end if;
      v_aggregate_type := 'menu_item';
      v_aggregate_id := v_row ->> 'menu_item_id';
      v_type := 'menu.publish_requested';
      v_payload := jsonb_build_object('channel', v_row ->> 'channel_id', 'mappingId', v_row ->> 'id', 'simulated', true);
    else
      return null;
  end case;

  if v_org is null or not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  insert into public.domain_events (organization_id, location_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
  values (v_org, v_location, v_type, v_aggregate_type, v_aggregate_id, v_payload, auth.uid(), case when auth.uid() is null then 'system' else 'user' end);
  return null;
end;
$$;

create trigger events_menu_items after update on public.menu_items
  for each row execute function private.emit_config_event();
create trigger events_channel_connections after update on public.channel_connections
  for each row execute function private.emit_config_event();
create trigger events_locations after insert or update on public.locations
  for each row execute function private.emit_config_event();
create trigger events_organization_settings after update on public.organization_settings
  for each row execute function private.emit_config_event();
create trigger events_memberships after insert or update on public.organization_memberships
  for each row execute function private.emit_config_event();
create trigger events_menu_channel_mappings after update on public.menu_channel_mappings
  for each row execute function private.emit_config_event();

-- ---------------------------------------------------------------------------
-- Permission changes: grants are inserted or deleted, never edited by clients;
-- every change (including any trusted UPDATE) is audited in full.

revoke update on public.membership_locations from authenticated, anon;

create or replace function private.audit_row_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_ignore text[] := coalesce(string_to_array(nullif(tg_argv[2], ''), ','), '{}');
  v_before jsonb;
  v_after jsonb;
  v_action text;
  v_entity_id text;
  v_location text;
  v_org text := v_row ->> 'organization_id';
  v_uid uuid := auth.uid();
  v_meta jsonb;
begin
  -- Changes made by another trigger or a cascading foreign-key action (e.g. an
  -- organization delete) are part of the parent change, not separate events.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
     and coalesce(current_setting('cornerops.audit_suspended', true), '') = 'on' then
    return null;
  end if;

  select d.before_data, d.after_data into v_before, v_after from private.audit_diff(v_old, v_new, v_ignore) d;
  if tg_op = 'UPDATE' and v_after = '{}'::jsonb then
    return null;  -- only ignored / bookkeeping columns changed
  end if;

  v_action := tg_argv[1] || case tg_op when 'INSERT' then '.created' when 'UPDATE' then '.updated' else '.deleted' end;
  v_entity_id := coalesce(v_row ->> 'id', v_row ->> 'organization_id');
  v_location := v_row ->> 'location_id';

  case tg_table_name
    when 'organizations' then
      v_org := v_row ->> 'id';
    when 'locations' then
      v_location := v_row ->> 'id';
    when 'menu_items' then
      if tg_op = 'UPDATE' and v_after ? 'isAvailable' then v_action := 'menu.availability_changed'; end if;
    when 'menu_item_recipes' then
      v_entity_id := v_row ->> 'menu_item_id';
      select mi.organization_id into v_org from public.menu_items mi where mi.id = v_row ->> 'menu_item_id';
    when 'channel_connections' then
      if tg_op = 'UPDATE' and v_after ? 'status' then v_action := 'channel.connection_changed'; end if;
      if tg_op = 'UPDATE' and v_after ? 'credentialReference' then v_action := 'channel.credentials_changed'; end if;
    when 'organization_memberships' then
      v_action := case
        when tg_op = 'INSERT' and v_row ->> 'status' = 'invited' then 'membership.invited'
        when tg_op = 'INSERT' then 'membership.created'
        when tg_op = 'DELETE' then 'membership.removed'
        when v_after ? 'status' and v_old ->> 'status' = 'invited' and v_new ->> 'status' = 'active' then 'membership.accepted'
        when v_after ? 'status' and v_new ->> 'status' = 'disabled' then 'membership.disabled'
        when v_after ? 'status' and v_new ->> 'status' = 'active' then 'membership.enabled'
        when v_after ? 'role' then 'membership.role_changed'
        else 'membership.updated'
      end;
    when 'membership_locations' then
      -- Permission changes keep the complete previous and new grant, not just the diff.
      v_entity_id := v_row ->> 'membership_id';
      v_action := case tg_op when 'INSERT' then 'membership.location_granted'
                             when 'UPDATE' then 'membership.location_changed'
                             else 'membership.location_revoked' end;
      v_before := case when v_old is null then null else jsonb_build_object('membershipId', v_old ->> 'membership_id', 'locationId', v_old ->> 'location_id', 'organizationId', v_old ->> 'organization_id') end;
      v_after := case when v_new is null then null else jsonb_build_object('membershipId', v_new ->> 'membership_id', 'locationId', v_new ->> 'location_id', 'organizationId', v_new ->> 'organization_id') end;
      v_meta := jsonb_build_object('membershipId', v_row ->> 'membership_id',
        'userId', (select m.user_id from public.organization_memberships m where m.id = (v_row ->> 'membership_id')::uuid),
        'role', (select m.role from public.organization_memberships m where m.id = (v_row ->> 'membership_id')::uuid));
    else
      null;
  end case;

  -- No organization (or it is being deleted in this statement): nothing to attach the entry to.
  if v_org is null or not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  insert into public.audit_logs (organization_id, location_id, actor_user_id, actor_label, action, entity_type, entity_id, before_data, after_data, metadata)
  values (v_org, v_location, v_uid, case when v_uid is null then 'system' else 'user' end, v_action, tg_argv[0], v_entity_id, v_before, v_after, coalesce(v_meta, '{}'::jsonb));
  return null;
end;
$$;

drop trigger audit_membership_locations on public.membership_locations;
create trigger audit_membership_locations after insert or update or delete on public.membership_locations
  for each row execute function private.audit_row_change('membership', 'membership', '');

-- ---------------------------------------------------------------------------
-- Channel telemetry requires a verified identity with access to the location.

create or replace function public.record_channel_activity(p_connection_id text, p_success boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.actor_uid();  -- refuses client sessions without an identity
  v_location text;
begin
  select c.location_id into v_location from public.channel_connections c where c.id = p_connection_id;
  if not found then
    raise exception 'channel connection not found' using errcode = 'P0002';
  end if;
  if v_uid is not null and not private.can_access_location(v_location) then
    raise exception 'channel connection not found' using errcode = 'P0002';
  end if;
  update public.channel_connections
     set last_sync_at = case when p_success then now() else last_sync_at end,
         error_count = error_count + case when p_success then 0 else 1 end
   where id = p_connection_id and status <> 'disconnected';
end;
$$;

revoke all on function private.normalize_domain_event(), private.emit_config_event(), private.audit_row_change() from public, anon, authenticated;
revoke all on function public.record_channel_activity(text, boolean) from public, anon;
grant execute on function public.record_channel_activity(text, boolean) to authenticated;

commit;
