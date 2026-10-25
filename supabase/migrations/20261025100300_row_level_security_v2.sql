-- CornerOps One v0.2 — Row Level Security (membership based)
--
-- Replaces the v0.1 JWT-claim policies. Access is derived from
-- organization_memberships (status = 'active') for auth.uid():
--
--   * Tenant isolation: a row is visible only to active members of its organization.
--   * Location scope:   OWNER / ADMIN / OPERATIONS_MANAGER see every location of their
--                       organization; BRANCH_MANAGER / KITCHEN_STAFF only the locations
--                       granted in membership_locations.
--   * Role-gated writes: settings, team, menu, channels and stock adjustments require
--                       the roles listed per policy.
--   * System-only tables (counters, demo state) have RLS enabled and no policies.
--
-- Helper functions are SECURITY DEFINER so policies can read memberships
-- without recursive RLS evaluation; they only ever answer for auth.uid().

begin;

-- ---------------------------------------------------------------------------
-- Remove v0.1 policies and helper

do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

drop function if exists public.current_organization_id();

-- ---------------------------------------------------------------------------
-- Helpers

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.member_org_ids()
returns setof text
language sql stable security definer set search_path = ''
as $$
  select m.organization_id from public.organization_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function private.org_ids_with_role(p_roles text[])
returns setof text
language sql stable security definer set search_path = ''
as $$
  select m.organization_id from public.organization_memberships m
  where m.user_id = auth.uid() and m.status = 'active' and m.role = any (p_roles)
$$;

create or replace function private.accessible_location_ids()
returns setof text
language sql stable security definer set search_path = ''
as $$
  select l.id
  from public.organization_memberships m
  join public.locations l on l.organization_id = m.organization_id
  where m.user_id = auth.uid()
    and m.status = 'active'
    and (
      m.role in ('OWNER', 'ADMIN', 'OPERATIONS_MANAGER')
      or exists (select 1 from public.membership_locations ml where ml.membership_id = m.id and ml.location_id = l.id)
    )
$$;

create or replace function private.colleague_user_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct other.user_id
  from public.organization_memberships mine
  join public.organization_memberships other on other.organization_id = mine.organization_id
  where mine.user_id = auth.uid() and mine.status = 'active' and other.user_id is not null
$$;

create or replace function private.can_access_location(p_location_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from private.accessible_location_ids() a where a = p_location_id)
$$;

grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Grants (RLS decides rows). anon gets nothing.

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke all on public.organization_counters, public.demo_workspace_state from authenticated;
revoke execute on function public.reserve_order_numbers(text, integer) from public, authenticated, anon;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'organization_memberships', 'membership_locations', 'restaurants', 'locations',
    'organization_settings', 'channels', 'channel_connections', 'channel_logs', 'customers', 'orders', 'order_items',
    'kitchen_tickets', 'menu_categories', 'menu_items', 'menu_item_recipes', 'menu_channel_mappings',
    'inventory_items', 'inventory_movements', 'alerts', 'daily_metrics', 'domain_events', 'audit_logs',
    'organization_counters', 'demo_workspace_state'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Organization-level tables --------------------------------------------------

create policy organizations_select on public.organizations for select to authenticated
  using (id in (select private.member_org_ids()));
create policy organizations_update on public.organizations for update to authenticated
  using (id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])))
  with check (id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or id in (select private.colleague_user_ids()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Members see their own membership; owners/admins see and manage the team.
-- Only an OWNER may create, modify or remove an OWNER membership.
create policy memberships_select on public.organization_memberships for select to authenticated
  using (user_id = auth.uid() or organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])));
create policy memberships_insert on public.organization_memberships for insert to authenticated
  with check (
    organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN']))
    and (role <> 'OWNER' or organization_id in (select private.org_ids_with_role(array['OWNER'])))
  );
create policy memberships_update on public.organization_memberships for update to authenticated
  using (
    organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN']))
    and (role <> 'OWNER' or organization_id in (select private.org_ids_with_role(array['OWNER'])))
  )
  with check (
    organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN']))
    and (role <> 'OWNER' or organization_id in (select private.org_ids_with_role(array['OWNER'])))
  );
create policy memberships_delete on public.organization_memberships for delete to authenticated
  using (
    organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN']))
    and (role <> 'OWNER' or organization_id in (select private.org_ids_with_role(array['OWNER'])))
  );

create policy membership_locations_select on public.membership_locations for select to authenticated
  using (
    organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN']))
    or membership_id in (select m.id from public.organization_memberships m where m.user_id = auth.uid())
  );
create policy membership_locations_write on public.membership_locations for all to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])))
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])));

create policy restaurants_select on public.restaurants for select to authenticated
  using (organization_id in (select private.member_org_ids()));
create policy restaurants_write on public.restaurants for all to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])))
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])));

create policy settings_select on public.organization_settings for select to authenticated
  using (organization_id in (select private.member_org_ids()));
create policy settings_update on public.organization_settings for update to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])))
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])));

create policy channels_select on public.channels for select to authenticated using (true);

create policy customers_select on public.customers for select to authenticated
  using (organization_id in (select private.member_org_ids()));
create policy customers_write on public.customers for insert to authenticated
  with check (organization_id in (select private.member_org_ids()));

-- Location-scoped tables -----------------------------------------------------

create policy locations_select on public.locations for select to authenticated
  using (id in (select private.accessible_location_ids()));
create policy locations_update on public.locations for update to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])))
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])));
create policy locations_insert on public.locations for insert to authenticated
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])));

create policy orders_select on public.orders for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy orders_insert on public.orders for insert to authenticated
  with check (location_id in (select private.accessible_location_ids()));
create policy orders_update on public.orders for update to authenticated
  using (location_id in (select private.accessible_location_ids()))
  with check (location_id in (select private.accessible_location_ids()));

create policy order_items_select on public.order_items for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy order_items_insert on public.order_items for insert to authenticated
  with check (location_id in (select private.accessible_location_ids()));

create policy kitchen_tickets_select on public.kitchen_tickets for select to authenticated
  using (location_id in (select private.accessible_location_ids()));

create policy channel_connections_select on public.channel_connections for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy channel_connections_write on public.channel_connections for all to authenticated
  using (
    location_id in (select private.accessible_location_ids())
    and organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER']))
  )
  with check (
    location_id in (select private.accessible_location_ids())
    and organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER']))
  );

create policy channel_logs_select on public.channel_logs for select to authenticated
  using (
    organization_id in (select private.member_org_ids())
    and (location_id is null or location_id in (select private.accessible_location_ids()))
  );
create policy channel_logs_insert on public.channel_logs for insert to authenticated
  with check (
    organization_id in (select private.member_org_ids())
    and (location_id is null or location_id in (select private.accessible_location_ids()))
  );

create policy inventory_items_select on public.inventory_items for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy inventory_items_write on public.inventory_items for update to authenticated
  using (
    location_id in (select private.accessible_location_ids())
    and organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER', 'BRANCH_MANAGER']))
  )
  with check (
    location_id in (select private.accessible_location_ids())
    and organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER', 'BRANCH_MANAGER']))
  );

create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using (location_id in (select private.accessible_location_ids()));
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated
  with check (
    location_id in (select private.accessible_location_ids())
    and organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER', 'BRANCH_MANAGER']))
    and actor_user_id = auth.uid()
  );

create policy daily_metrics_select on public.daily_metrics for select to authenticated
  using (location_id in (select private.accessible_location_ids()));

create policy alerts_select on public.alerts for select to authenticated
  using (
    organization_id in (select private.member_org_ids())
    and (location_id is null or location_id in (select private.accessible_location_ids()))
  );
create policy alerts_insert on public.alerts for insert to authenticated
  with check (
    organization_id in (select private.member_org_ids())
    and (location_id is null or location_id in (select private.accessible_location_ids()))
  );
create policy alerts_update on public.alerts for update to authenticated
  using (
    organization_id in (select private.member_org_ids())
    and (location_id is null or location_id in (select private.accessible_location_ids()))
  )
  with check (organization_id in (select private.member_org_ids()));

-- Menu (organization-wide catalog) ------------------------------------------

create policy menu_categories_select on public.menu_categories for select to authenticated
  using (organization_id in (select private.member_org_ids()));
create policy menu_categories_write on public.menu_categories for all to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])))
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])));

create policy menu_items_select on public.menu_items for select to authenticated
  using (organization_id in (select private.member_org_ids()));
create policy menu_items_write on public.menu_items for all to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])))
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])));

create policy menu_item_recipes_select on public.menu_item_recipes for select to authenticated
  using (menu_item_id in (select mi.id from public.menu_items mi where mi.organization_id in (select private.member_org_ids())));
create policy menu_item_recipes_write on public.menu_item_recipes for all to authenticated
  using (menu_item_id in (select mi.id from public.menu_items mi where mi.organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER']))))
  with check (menu_item_id in (select mi.id from public.menu_items mi where mi.organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER']))));

create policy menu_mappings_select on public.menu_channel_mappings for select to authenticated
  using (organization_id in (select private.member_org_ids()));
create policy menu_mappings_write on public.menu_channel_mappings for all to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])))
  with check (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])));

-- Events & audit -------------------------------------------------------------
-- Any member may append for their own actions; reads are restricted.

create policy domain_events_select on public.domain_events for select to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN', 'OPERATIONS_MANAGER'])));
create policy domain_events_insert on public.domain_events for insert to authenticated
  with check (
    organization_id in (select private.member_org_ids())
    and actor_user_id = auth.uid()
    and (location_id is null or location_id in (select private.accessible_location_ids()))
  );

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id in (select private.org_ids_with_role(array['OWNER', 'ADMIN'])));
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (
    organization_id in (select private.member_org_ids())
    and actor_user_id = auth.uid()
    and (location_id is null or location_id in (select private.accessible_location_ids()))
  );

-- ---------------------------------------------------------------------------
-- Security-definer operations. Each verifies the caller's access itself.

-- Deduct recipe ingredients for an accepted order (any member who can work the
-- order's location, including kitchen staff, may trigger it). Idempotent.
create or replace function public.apply_order_inventory_usage(p_order_id text, p_actor_label text default 'user')
returns table (inventory_item_id text, ingredient_key text, item_name text, location_id text, unit text, threshold numeric, before_quantity numeric, after_quantity numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  r record;
  v_after numeric;
begin
  select o.id, o.organization_id, o.location_id, o.order_number into v_order from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null and not private.can_access_location(v_order.location_id) then
    raise exception 'forbidden location' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.inventory_movements m where m.order_id = p_order_id and m.type = 'usage') then
    return;
  end if;

  for r in
    select ii.id, ii.ingredient_key, ii.name, ii.location_id, ii.unit, ii.threshold, ii.quantity, u.qty
    from (
      select rcp.ingredient_key, sum(rcp.quantity * oi.quantity) as qty
      from public.order_items oi
      join public.menu_item_recipes rcp on rcp.menu_item_id = oi.menu_item_id
      where oi.order_id = p_order_id
      group by rcp.ingredient_key
    ) u
    join public.inventory_items ii on ii.location_id = v_order.location_id and ii.ingredient_key = u.ingredient_key
    order by ii.id
    for update of ii
  loop
    v_after := greatest(0, r.quantity - r.qty);
    update public.inventory_items set quantity = v_after where id = r.id;
    insert into public.inventory_movements (id, organization_id, location_id, inventory_item_id, type, quantity, note, order_id, actor_user_id, actor_label, reason)
    values ('mov_' || replace(gen_random_uuid()::text, '-', ''), v_order.organization_id, v_order.location_id, r.id, 'usage',
            -(r.quantity - v_after), v_order.order_number, p_order_id, auth.uid(), p_actor_label, 'order_accepted');
    inventory_item_id := r.id; ingredient_key := r.ingredient_key; item_name := r.name; location_id := r.location_id;
    unit := r.unit; threshold := r.threshold; before_quantity := r.quantity; after_quantity := v_after;
    return next;
  end loop;
end;
$$;

-- Channel adapter telemetry (last sync / error count) recorded while any member
-- works an order; changing connection status still requires manager roles.
create or replace function public.record_channel_activity(p_connection_id text, p_success boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_location text;
begin
  select c.location_id into v_location from public.channel_connections c where c.id = p_connection_id;
  if not found then return; end if;
  if auth.uid() is not null and not private.can_access_location(v_location) then
    raise exception 'forbidden location' using errcode = 'insufficient_privilege';
  end if;
  update public.channel_connections
     set last_sync_at = case when p_success then now() else last_sync_at end,
         error_count = error_count + case when p_success then 0 else 1 end
   where id = p_connection_id and status <> 'disconnected';
end;
$$;

-- Onboarding: the signed-in user creates an organization and becomes OWNER.
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
  return v_org;
end;
$$;

-- Invitations are claimed when a user with a confirmed, matching email signs in.
create or replace function public.claim_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if auth.uid() is null then return 0; end if;
  update public.organization_memberships m
     set user_id = auth.uid(), status = 'active', updated_at = now()
   where m.user_id is null
     and m.status = 'invited'
     and lower(m.invited_email) = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
     and not exists (select 1 from public.organization_memberships x where x.organization_id = m.organization_id and x.user_id = auth.uid());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_order_inventory_usage(text, text), public.record_channel_activity(text, boolean),
  public.create_organization(text, text, text, text, jsonb), public.claim_pending_invitations() from public, anon;
grant execute on function public.apply_order_inventory_usage(text, text), public.record_channel_activity(text, boolean),
  public.create_organization(text, text, text, text, jsonb), public.claim_pending_invitations() to authenticated;

commit;
