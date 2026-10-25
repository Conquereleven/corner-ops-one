-- CornerOps One v0.2.1 — access hardening
--
-- 1. Financial and cost data (platform commission, food cost, ingredient unit
--    cost, commercial terms, credential references) are not readable by client
--    roles. Finance roles (OWNER, ADMIN, OPERATIONS_MANAGER) read them through
--    narrow SECURITY DEFINER functions that check the caller's membership.
-- 2. Configuration changes are audited by the database itself (triggers), so an
--    audit entry cannot be skipped by application code or forged by a client.
-- 3. Domain events are fully immutable apart from outbox processing columns.
-- 4. Function hygiene: fixed search paths, no PUBLIC execute, no anon access.

begin;

-- ---------------------------------------------------------------------------
-- 1. Financial data

-- Column-level SELECT: every column except the hidden ones. New columns added
-- later are not readable until granted explicitly (fail closed).
do $$
declare
  r record;
  v_cols text;
begin
  for r in
    select * from (values
      ('orders', array['platform_fee']),
      ('menu_items', array['food_cost']),
      ('inventory_items', array['unit_cost']),
      ('organization_settings', array['economics']),
      ('daily_metrics', array['platform_fees']),
      ('channel_connections', array['credential_reference'])
    ) as t(tbl, hidden)
  loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = r.tbl and c.column_name <> all (r.hidden);
    execute format('revoke select on public.%I from authenticated, anon', r.tbl);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, r.tbl);
  end loop;
end $$;

-- Settings: created by create_organization(), never deleted by clients; only
-- the configuration sections are writable (RLS limits writers to OWNER/ADMIN).
revoke insert, update, delete on public.organization_settings from authenticated, anon;
grant update (sla, economics, demo, ai_provider) on public.organization_settings to authenticated;

-- daily_metrics has no client writers.
revoke insert, update, delete on public.daily_metrics from authenticated, anon;

create or replace function private.can_view_financials(p_org text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_system_caller()
      or coalesce(private.member_role(p_org), '') in ('OWNER', 'ADMIN', 'OPERATIONS_MANAGER')
$$;

create or replace function private.require_financials(p_org text)
returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not private.can_view_financials(p_org) then
    raise exception 'financial data is limited to owners, admins and operations managers' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.financial_menu_costs(p_org text)
returns table (menu_item_id text, food_cost numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_financials(p_org);
  return query select mi.id, mi.food_cost from public.menu_items mi where mi.organization_id = p_org;
end;
$$;

create or replace function public.financial_inventory_costs(p_org text)
returns table (inventory_item_id text, unit_cost numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_financials(p_org);
  return query
    select ii.id, ii.unit_cost from public.inventory_items ii
     where ii.organization_id = p_org
       and (private.is_system_caller() or ii.location_id in (select private.accessible_location_ids()));
end;
$$;

create or replace function public.financial_order_fees(p_org text, p_order_ids text[])
returns table (order_id text, platform_fee numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_financials(p_org);
  return query
    select o.id, o.platform_fee from public.orders o
     where o.organization_id = p_org and o.id = any (p_order_ids)
       and (private.is_system_caller() or o.location_id in (select private.accessible_location_ids()));
end;
$$;

create or replace function public.financial_economics(p_org text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform private.require_financials(p_org);
  select s.economics into v from public.organization_settings s where s.organization_id = p_org;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Database-side audit of configuration changes

create or replace function private.camel(p_key text)
returns text
language sql immutable set search_path = ''
as $$
  select string_agg(case when t.i = 1 then t.part else initcap(t.part) end, '' order by t.i)
  from unnest(string_to_array(p_key, '_')) with ordinality as t(part, i)
$$;

-- Changed keys only, camelCased, with secrets redacted.
create or replace function private.audit_diff(p_old jsonb, p_new jsonb, p_ignore text[])
returns table (before_data jsonb, after_data jsonb)
language sql immutable set search_path = ''
as $$
  with keys as (
    select k from (select jsonb_object_keys(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as k) x
    where k <> all (p_ignore || array['created_at', 'updated_at'])
      and (p_old -> k) is distinct from (p_new -> k)
  )
  select
    case when p_old is null then null else coalesce(jsonb_object_agg(private.camel(k),
      case when k = 'credential_reference' and p_old ? k and p_old -> k <> 'null'::jsonb then '"[redacted]"'::jsonb else p_old -> k end)
      filter (where p_old ? k), '{}'::jsonb) end,
    case when p_new is null then null else coalesce(jsonb_object_agg(private.camel(k),
      case when k = 'credential_reference' and p_new ? k and p_new -> k <> 'null'::jsonb then '"[redacted]"'::jsonb else p_new -> k end)
      filter (where p_new ? k), '{}'::jsonb) end
  from keys
$$;

-- Generic row audit. TG_ARGV: [0] entity type, [1] action prefix, [2] ignored columns (comma separated).
-- Skipped for cascaded changes (the parent change is the audited event) and,
-- for trusted connections only, while a seed/reset sets cornerops.audit_suspended.
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
      v_entity_id := v_row ->> 'membership_id';
      v_action := case tg_op when 'INSERT' then 'membership.location_granted' else 'membership.location_revoked' end;
    else
      null;
  end case;

  -- No organization (or it is being deleted in this statement): nothing to attach the entry to.
  if v_org is null or not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;
  insert into public.audit_logs (organization_id, location_id, actor_user_id, actor_label, action, entity_type, entity_id, before_data, after_data)
  values (v_org, v_location, v_uid, case when v_uid is null then 'system' else 'user' end, v_action, tg_argv[0], v_entity_id, v_before, v_after);
  return null;
end;
$$;

create trigger audit_organizations after update on public.organizations
  for each row execute function private.audit_row_change('organization', 'organization', '');
create trigger audit_organization_settings after update on public.organization_settings
  for each row execute function private.audit_row_change('organization_settings', 'settings', '');
create trigger audit_restaurants after insert or update or delete on public.restaurants
  for each row execute function private.audit_row_change('restaurant', 'restaurant', '');
create trigger audit_locations after insert or update or delete on public.locations
  for each row execute function private.audit_row_change('location', 'location', '');
create trigger audit_memberships after insert or update or delete on public.organization_memberships
  for each row execute function private.audit_row_change('membership', 'membership', '');
create trigger audit_membership_locations after insert or delete on public.membership_locations
  for each row execute function private.audit_row_change('membership', 'membership', '');
create trigger audit_menu_categories after insert or update or delete on public.menu_categories
  for each row execute function private.audit_row_change('menu_category', 'menu.category', '');
create trigger audit_menu_items after insert or update or delete on public.menu_items
  for each row execute function private.audit_row_change('menu_item', 'menu.item', 'popularity');
create trigger audit_menu_item_recipes after insert or update or delete on public.menu_item_recipes
  for each row execute function private.audit_row_change('menu_item', 'menu.recipe', '');
create trigger audit_channel_connections after insert or update or delete on public.channel_connections
  for each row execute function private.audit_row_change('channel_connection', 'channel.connection', 'last_sync_at,error_count,latency_ms,message');

-- Onboarding records its own creation event (the row triggers above only see updates for organizations).
create or replace function public.create_organization(p_name text, p_slug text, p_timezone text, p_currency text, p_settings jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_org text := 'org_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  insert into public.organizations (id, name, slug, timezone, currency, is_demo) values (v_org, p_name, p_slug, p_timezone, p_currency, false);
  insert into public.restaurants (id, organization_id, name) values ('rst_' || substr(v_org, 5), v_org, p_name);
  insert into public.organization_memberships (organization_id, user_id, role, status) values (v_org, auth.uid(), 'OWNER', 'active');
  insert into public.organization_settings (organization_id, sla, economics, demo) values (v_org, p_settings -> 'sla', p_settings -> 'economics', p_settings -> 'demo');
  insert into public.organization_counters (organization_id) values (v_org);
  insert into public.audit_logs (organization_id, actor_user_id, actor_label, action, entity_type, entity_id, after_data)
  values (v_org, auth.uid(), 'user', 'organization.created', 'organization', v_org, jsonb_build_object('name', p_name));
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Domain events: immutable except outbox processing state

create or replace function public.protect_domain_events()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Cascade from an organization delete, or an explicit purge by a trusted connection.
    if pg_trigger_depth() > 1
       or (current_user not in ('authenticated', 'anon') and coalesce(current_setting('cornerops.allow_event_purge', true), '') = 'on') then
      return old;
    end if;
    raise exception 'domain_events cannot be deleted' using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - array['processed_at', 'attempts', 'last_error'])
     is distinct from (to_jsonb(old) - array['processed_at', 'attempts', 'last_error']) then
    raise exception 'domain_events are immutable (only processing columns may change)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger domain_events_immutable on public.domain_events;
create trigger domain_events_immutable
  before update or delete on public.domain_events
  for each row execute function public.protect_domain_events();

revoke update, delete on public.domain_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. Function and grant hygiene

-- Audit rows: the purge flag is honoured only for trusted connections (demo reset).
create or replace function public.protect_audit_logs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_logs are append-only' using errcode = 'insufficient_privilege';
  end if;
  -- pg_trigger_depth() > 1: invoked by an ON DELETE CASCADE from organizations.
  if pg_trigger_depth() > 1
     or (current_user not in ('authenticated', 'anon') and coalesce(current_setting('cornerops.allow_audit_purge', true), '') = 'on') then
    return old;
  end if;
  raise exception 'audit_logs cannot be deleted' using errcode = 'insufficient_privilege';
end;
$$;
revoke update, delete on public.audit_logs from authenticated, anon;

alter function public.touch_updated_at() set search_path = '';
alter function public.reserve_order_numbers(text, integer) set search_path = '';

-- No function is executable by PUBLIC/anon by default; client-callable ones are granted explicitly.
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

-- Helpers used inside RLS policies (evaluated as the client role).
grant execute on function private.member_org_ids(), private.org_ids_with_role(text[]), private.accessible_location_ids(),
  private.colleague_user_ids(), private.can_access_location(text) to authenticated;

-- Client-callable operations.
grant execute on function public.apply_order_transition(text, text, text, text, jsonb, text, jsonb),
  public.apply_order_inventory_usage(text, text), public.record_inventory_movement(text, text, numeric, text, text),
  public.resolve_order_shortfall(text, text, text), public.record_channel_activity(text, boolean),
  public.create_organization(text, text, text, text, jsonb), public.claim_pending_invitations(),
  public.financial_menu_costs(text), public.financial_inventory_costs(text),
  public.financial_order_fees(text, text[]), public.financial_economics(text) to authenticated;

-- anon (Supabase publishable key without a session) has no table access at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Profiles are created by the auth trigger and never deleted by clients.
revoke insert, delete on public.profiles from authenticated;

commit;
