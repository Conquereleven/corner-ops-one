-- CornerOps One v0.2.1 — authorized order & inventory operations
--
-- Order status and stock levels can no longer be changed with direct table
-- writes by application users. State changes go through narrowly authorized
-- SECURITY DEFINER operations that enforce the business rules at the database
-- boundary and record inventory movements, domain events and audit entries in
-- the same transaction:
--
--   public.apply_order_transition(...)      order lifecycle (state machine, role, location)
--   public.apply_order_inventory_usage(...) recipe consumption for accepted orders (idempotent)
--   public.record_inventory_movement(...)   purchases, adjustments, waste, transfers
--
-- Shortage policy (pending founder approval, see docs/inventory-shortage-policy.md):
-- on-hand stock is deducted only up to what exists; the unmet remainder is
-- recorded as `shortfall_quantity` on the movement and as an
-- `inventory.shortfall` event — never silently clamped or invented.

begin;

-- ---------------------------------------------------------------------------
-- Inventory movement bookkeeping

alter table public.inventory_movements
  add column requested_quantity numeric(12, 3),
  add column shortfall_quantity numeric(12, 3) not null default 0 check (shortfall_quantity >= 0);

comment on column public.inventory_movements.requested_quantity is 'Recipe demand for usage movements (quantity is what was actually deducted).';
comment on column public.inventory_movements.shortfall_quantity is 'Demand that could not be met from on-hand stock.';

-- At most one usage movement per (order, inventory item): concurrent or
-- repeated consumption is rejected by the database.
create unique index inventory_movements_one_usage_per_order_item
  on public.inventory_movements (order_id, inventory_item_id) where type = 'usage' and order_id is not null;

-- ---------------------------------------------------------------------------
-- Guards: protected columns change only inside the authorized operations,
-- even for privileged connections (defence in depth against code bugs).

create or replace function private.guard_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('cornerops.order_transition', true), '') = 'on'
     or coalesce(current_setting('cornerops.bypass_order_guard', true), '') = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.accepted_at is distinct from old.accepted_at
     or new.preparation_started_at is distinct from old.preparation_started_at
     or new.ready_at is distinct from old.ready_at
     or new.picked_up_at is distinct from old.picked_up_at
     or new.completed_at is distinct from old.completed_at
     or new.cancelled_at is distinct from old.cancelled_at
     or new.cancellation_reason is distinct from old.cancellation_reason
     or new.subtotal is distinct from old.subtotal
     or new.discount is distinct from old.discount
     or new.delivery_fee is distinct from old.delivery_fee
     or new.platform_fee is distinct from old.platform_fee
     or new.tax is distinct from old.tax
     or new.total is distinct from old.total
     or new.organization_id is distinct from old.organization_id
     or new.location_id is distinct from old.location_id
     or new.channel_id is distinct from old.channel_id
     or new.external_order_id is distinct from old.external_order_id
     or new.order_number is distinct from old.order_number then
    raise exception 'order status and financial fields change only through apply_order_transition()' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger orders_guard_protected_columns before update on public.orders
  for each row execute function private.guard_order_update();

create or replace function private.guard_inventory_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.quantity is distinct from old.quantity
     and coalesce(current_setting('cornerops.inventory_write', true), '') <> 'on'
     and coalesce(current_setting('cornerops.bypass_inventory_guard', true), '') <> 'on' then
    raise exception 'stock levels change only through inventory operations (movements)' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger inventory_items_guard_quantity before update on public.inventory_items
  for each row execute function private.guard_inventory_update();

-- ---------------------------------------------------------------------------
-- Helpers

create or replace function private.stock_level(p_quantity numeric, p_threshold numeric)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_quantity <= 0.0001 then 'out'
    when p_quantity <= p_threshold * 0.5 then 'critical'
    when p_quantity <= p_threshold then 'low'
    else 'healthy'
  end
$$;

create or replace function private.member_role(p_org text)
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.organization_memberships m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
$$;

create or replace function private.order_lifecycle(o public.orders)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'status', o.status, 'acceptedAt', o.accepted_at, 'preparationStartedAt', o.preparation_started_at,
    'readyAt', o.ready_at, 'pickedUpAt', o.picked_up_at, 'completedAt', o.completed_at,
    'cancelledAt', o.cancelled_at, 'cancellationReason', o.cancellation_reason)
$$;

-- Emit low / out-of-stock events when a change crosses a stock level.
create or replace function private.emit_stock_level_events(
  p_org text, p_location text, p_item_id text, p_name text, p_unit text, p_threshold numeric,
  p_before numeric, p_after numeric, p_actor uuid, p_label text, p_cause jsonb)
returns void
language plpgsql set search_path = ''
as $$
declare
  v_before text := private.stock_level(p_before, p_threshold);
  v_after text := private.stock_level(p_after, p_threshold);
begin
  if v_after = v_before then return; end if;
  if v_after = 'out' or (v_before = 'healthy' and v_after in ('low', 'critical')) then
    insert into public.domain_events (organization_id, location_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
    values (p_org, p_location, case when v_after = 'out' then 'inventory.out_of_stock' else 'inventory.low' end, 'inventory_item', p_item_id,
            jsonb_build_object('name', p_name, 'quantity', p_after, 'threshold', p_threshold, 'unit', p_unit) || coalesce(p_cause, '{}'::jsonb),
            p_actor, p_label);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recipe consumption for an accepted order (internal core)

create or replace function private.consume_order_inventory(p_order_id text, p_actor uuid, p_label text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  r record;
  v_deducted numeric;
  v_after numeric;
  v_shortfalls jsonb := '[]'::jsonb;
  v_lines integer := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.accepted_at is null or v_order.status not in ('accepted', 'preparing', 'ready', 'picked_up', 'completed') then
    raise exception 'inventory is consumed only for accepted orders (order is %)', v_order.status using errcode = '23514';
  end if;
  if exists (select 1 from public.inventory_movements m where m.order_id = p_order_id and m.type = 'usage') then
    return 0;  -- already consumed (idempotent)
  end if;

  perform set_config('cornerops.inventory_write', 'on', true);
  for r in
    select u.ingredient_key, u.demand, ii.id as item_id, ii.name, ii.unit, ii.threshold, ii.quantity
    from (
      select rcp.ingredient_key, sum(rcp.quantity * oi.quantity) as demand
      from public.order_items oi
      join public.menu_item_recipes rcp on rcp.menu_item_id = oi.menu_item_id
      where oi.order_id = p_order_id
      group by rcp.ingredient_key
    ) u
    left join public.inventory_items ii on ii.location_id = v_order.location_id and ii.ingredient_key = u.ingredient_key
    order by u.ingredient_key
  loop
    if r.item_id is null then
      -- Ingredient not stocked at this location: demand is recorded, not ignored.
      v_shortfalls := v_shortfalls || jsonb_build_object('ingredientKey', r.ingredient_key, 'requested', r.demand, 'deducted', 0, 'shortfall', r.demand, 'tracked', false);
      continue;
    end if;
    perform 1 from public.inventory_items where id = r.item_id for update;
    select quantity into r.quantity from public.inventory_items where id = r.item_id;
    v_deducted := least(r.quantity, r.demand);
    v_after := r.quantity - v_deducted;
    update public.inventory_items set quantity = v_after where id = r.item_id;
    insert into public.inventory_movements (id, organization_id, location_id, inventory_item_id, type, quantity, requested_quantity, shortfall_quantity,
                                            note, order_id, actor_user_id, actor_label, reason)
    values ('mov_' || replace(gen_random_uuid()::text, '-', ''), v_order.organization_id, v_order.location_id, r.item_id, 'usage',
            -v_deducted, r.demand, r.demand - v_deducted, v_order.order_number, p_order_id, p_actor, p_label, 'order_accepted');
    v_lines := v_lines + 1;
    if r.demand > v_deducted then
      v_shortfalls := v_shortfalls || jsonb_build_object('inventoryItemId', r.item_id, 'ingredientKey', r.ingredient_key, 'name', r.name, 'unit', r.unit,
                                                         'requested', r.demand, 'deducted', v_deducted, 'shortfall', r.demand - v_deducted, 'tracked', true);
    end if;
    perform private.emit_stock_level_events(v_order.organization_id, v_order.location_id, r.item_id, r.name, r.unit, r.threshold,
                                            r.quantity, v_after, p_actor, p_label, jsonb_build_object('causedByOrder', v_order.order_number));
  end loop;
  perform set_config('cornerops.inventory_write', 'off', true);

  if jsonb_array_length(v_shortfalls) > 0 then
    insert into public.domain_events (organization_id, location_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
    values (v_order.organization_id, v_order.location_id, 'inventory.shortfall', 'order', p_order_id,
            jsonb_build_object('orderNumber', v_order.order_number, 'lines', v_shortfalls), p_actor, p_label);
    insert into public.audit_logs (organization_id, location_id, actor_user_id, actor_label, action, entity_type, entity_id, after_data, metadata)
    values (v_order.organization_id, v_order.location_id, p_actor, p_label, 'inventory.shortfall', 'order', p_order_id,
            jsonb_build_object('lines', v_shortfalls), jsonb_build_object('orderNumber', v_order.order_number));
  end if;
  return v_lines;
end;
$$;

-- Public wrapper (kept for resilience / reprocessing). Callers must be able to
-- work the order's location; consumption is idempotent and lifecycle-checked.
drop function if exists public.apply_order_inventory_usage(text, text);
create function public.apply_order_inventory_usage(p_order_id text, p_actor_label text default 'user')
returns table (inventory_item_id text, ingredient_key text, item_name text, location_id text, unit text, threshold numeric,
               before_quantity numeric, after_quantity numeric, requested_quantity numeric, shortfall_quantity numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location text;
  v_lines integer;
begin
  select o.location_id into v_location from public.orders o where o.id = p_order_id;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if auth.uid() is not null and not private.can_access_location(v_location) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  v_lines := private.consume_order_inventory(p_order_id, auth.uid(), case when auth.uid() is null then coalesce(p_actor_label, 'system') else 'user' end);
  if v_lines = 0 then return; end if;
  return query
    select m.inventory_item_id, ii.ingredient_key, ii.name, m.location_id, ii.unit, ii.threshold,
           ii.quantity - m.quantity, ii.quantity, m.requested_quantity, m.shortfall_quantity
    from public.inventory_movements m join public.inventory_items ii on ii.id = m.inventory_item_id
    where m.order_id = p_order_id and m.type = 'usage';
end;
$$;

-- ---------------------------------------------------------------------------
-- Order lifecycle

create or replace function public.apply_order_transition(
  p_order_id text,
  p_action text,
  p_reason text default null,
  p_sync_status text default null,
  p_courier jsonb default null,
  p_actor_label text default null,
  p_channel_sync jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_label text := case when auth.uid() is null then coalesce(nullif(p_actor_label, ''), 'system') else 'user' end;
  v_role text;
  o public.orders%rowtype;
  n public.orders%rowtype;
  v_to text;
  v_now timestamptz := now();
  v_first_accept boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if v_uid is not null then
    if not private.can_access_location(o.location_id) then
      raise exception 'order not found' using errcode = 'P0002';  -- do not reveal other locations' orders
    end if;
    v_role := private.member_role(o.organization_id);
    if v_role is null then
      raise exception 'not a member of this organization' using errcode = '42501';
    end if;
    if p_action = 'cancel' and v_role not in ('OWNER', 'ADMIN', 'OPERATIONS_MANAGER', 'BRANCH_MANAGER') then
      raise exception 'your role cannot cancel orders' using errcode = '42501';
    end if;
  end if;

  v_to := case p_action
    when 'accept' then case when o.status = 'new' then 'accepted' end
    when 'start_preparing' then case when o.status in ('new', 'accepted') then 'preparing' end
    when 'mark_ready' then case when o.status in ('accepted', 'preparing') then 'ready' end
    when 'mark_picked_up' then case when o.status = 'ready' then 'picked_up' end
    when 'complete' then case when o.status = 'picked_up' or (o.status = 'ready' and o.fulfillment = 'pickup') then 'completed' end
    when 'cancel' then case when o.status in ('new', 'accepted', 'preparing', 'ready') then 'cancelled' end
  end;
  if v_to is null then
    raise exception 'cannot % an order that is %', replace(p_action, '_', ' '), replace(o.status, '_', ' ') using errcode = '23514';
  end if;
  if p_sync_status is not null and p_sync_status not in ('synced', 'pending', 'failed') then
    raise exception 'invalid sync status' using errcode = '22023';
  end if;

  v_first_accept := o.accepted_at is null and p_action in ('accept', 'start_preparing');

  perform set_config('cornerops.order_transition', 'on', true);
  update public.orders set
    status = v_to,
    accepted_at = case when p_action in ('accept', 'start_preparing') then coalesce(accepted_at, v_now) else accepted_at end,
    preparation_started_at = case when p_action = 'start_preparing' then v_now
                                  when p_action = 'mark_ready' then coalesce(preparation_started_at, v_now) else preparation_started_at end,
    ready_at = case when p_action = 'mark_ready' then v_now else ready_at end,
    picked_up_at = case when p_action = 'mark_picked_up' then v_now
                        when p_action = 'complete' then coalesce(picked_up_at, v_now) else picked_up_at end,
    completed_at = case when p_action = 'complete' then v_now else completed_at end,
    cancelled_at = case when p_action = 'cancel' then v_now else cancelled_at end,
    cancellation_reason = case when p_action = 'cancel' then coalesce(nullif(btrim(p_reason), ''), 'Cancelled by restaurant') else cancellation_reason end,
    courier = coalesce(p_courier, courier),
    sync_status = coalesce(p_sync_status, sync_status),
    metadata = metadata
      || jsonb_build_object('history', coalesce(metadata -> 'history', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('action', p_action, 'at', v_now, 'by', coalesce(v_uid::text, v_label))))
      || case when v_uid is not null then '{"manual": true}'::jsonb else '{}'::jsonb end,
    updated_at = v_now
  where id = o.id
  returning * into n;
  perform set_config('cornerops.order_transition', 'off', true);

  if v_first_accept then
    perform private.consume_order_inventory(o.id, v_uid, v_label);
  end if;

  insert into public.domain_events (organization_id, location_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
  values (o.organization_id, o.location_id, 'order.' || v_to, 'order', o.id,
          jsonb_build_object('orderNumber', o.order_number, 'channel', o.channel_id, 'externalOrderId', o.external_order_id,
                             'from', o.status, 'to', v_to, 'reason', n.cancellation_reason, 'channelSync', p_channel_sync),
          v_uid, v_label);
  insert into public.audit_logs (organization_id, location_id, actor_user_id, actor_label, action, entity_type, entity_id, before_data, after_data, metadata)
  values (o.organization_id, o.location_id, v_uid, v_label,
          case when v_to = 'cancelled' then 'order.cancelled' else 'order.status_changed' end, 'order', o.id,
          private.order_lifecycle(o), private.order_lifecycle(n),
          jsonb_build_object('orderNumber', o.order_number, 'channel', o.channel_id, 'action', p_action, 'reason', p_reason));

  return jsonb_build_object('id', n.id, 'status', n.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual stock movements

create or replace function public.record_inventory_movement(
  p_inventory_item_id text,
  p_type text,
  p_quantity numeric,
  p_note text default null,
  p_target_location_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_label text := case when auth.uid() is null then 'system' else 'user' end;
  i public.inventory_items%rowtype;
  t public.inventory_items%rowtype;
  v_signed numeric;
  v_mag numeric := abs(p_quantity);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_loc_from text;
  v_loc_to text;
begin
  if p_type not in ('purchase', 'usage', 'adjustment', 'waste', 'transfer') then
    raise exception 'invalid movement type' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity = 0 or v_mag >= 100000 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 200 then
    raise exception 'note too long' using errcode = '22023';
  end if;

  select * into i from public.inventory_items where id = p_inventory_item_id;
  if not found then
    raise exception 'inventory item not found' using errcode = 'P0002';
  end if;
  if v_uid is not null then
    if not private.can_access_location(i.location_id) then
      raise exception 'inventory item not found' using errcode = 'P0002';
    end if;
    if coalesce(private.member_role(i.organization_id), '') not in ('OWNER', 'ADMIN', 'OPERATIONS_MANAGER', 'BRANCH_MANAGER') then
      raise exception 'your role cannot adjust stock' using errcode = '42501';
    end if;
  end if;

  if p_type = 'transfer' then
    if p_target_location_id is null or p_target_location_id = i.location_id then
      raise exception 'choose a different destination location' using errcode = '22023';
    end if;
    if v_uid is not null and not private.can_access_location(p_target_location_id) then
      raise exception 'destination location not accessible' using errcode = '42501';
    end if;
    select * into t from public.inventory_items
     where organization_id = i.organization_id and location_id = p_target_location_id and ingredient_key = i.ingredient_key;
    if not found then
      raise exception 'destination does not stock this item' using errcode = '22023';
    end if;
  end if;

  -- Lock in id order to avoid deadlocks between concurrent transfers.
  perform 1 from public.inventory_items where id in (i.id, t.id) order by id for update;
  select * into i from public.inventory_items where id = p_inventory_item_id;
  if t.id is not null then select * into t from public.inventory_items where id = t.id; end if;

  v_signed := case p_type when 'purchase' then v_mag when 'adjustment' then p_quantity else -v_mag end;
  if i.quantity + v_signed < 0 then
    raise exception 'only % % of % in stock', i.quantity, i.unit, i.name using errcode = '23514';
  end if;

  perform set_config('cornerops.inventory_write', 'on', true);
  update public.inventory_items set quantity = i.quantity + v_signed where id = i.id;
  select name into v_loc_from from public.locations where id = i.location_id;
  if t.id is not null then select name into v_loc_to from public.locations where id = t.location_id; end if;
  insert into public.inventory_movements (id, organization_id, location_id, inventory_item_id, type, quantity, note, actor_user_id, actor_label, reason)
  values ('mov_' || replace(gen_random_uuid()::text, '-', ''), i.organization_id, i.location_id, i.id, p_type, v_signed,
          coalesce(v_note, case when p_type = 'transfer' then 'Transfer to ' || v_loc_to end), v_uid, v_label, coalesce(v_note, p_type));
  insert into public.domain_events (organization_id, location_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
  values (i.organization_id, i.location_id, 'inventory.adjusted', 'inventory_item', i.id,
          jsonb_build_object('name', i.name, 'type', p_type, 'quantity', v_signed, 'unit', i.unit, 'from', i.quantity, 'to', i.quantity + v_signed), v_uid, v_label);
  insert into public.audit_logs (organization_id, location_id, actor_user_id, actor_label, action, entity_type, entity_id, before_data, after_data, metadata)
  values (i.organization_id, i.location_id, v_uid, v_label, 'inventory.adjusted', 'inventory_item', i.id,
          jsonb_build_object('quantity', i.quantity), jsonb_build_object('quantity', i.quantity + v_signed),
          jsonb_build_object('type', p_type, 'quantity', v_signed, 'note', v_note, 'name', i.name, 'unit', i.unit));
  perform private.emit_stock_level_events(i.organization_id, i.location_id, i.id, i.name, i.unit, i.threshold, i.quantity, i.quantity + v_signed, v_uid, v_label, null);

  if t.id is not null then
    update public.inventory_items set quantity = t.quantity + v_mag where id = t.id;
    insert into public.inventory_movements (id, organization_id, location_id, inventory_item_id, type, quantity, note, actor_user_id, actor_label, reason)
    values ('mov_' || replace(gen_random_uuid()::text, '-', ''), t.organization_id, t.location_id, t.id, 'transfer', v_mag,
            coalesce(v_note, 'Transfer from ' || v_loc_from), v_uid, v_label, coalesce(v_note, 'transfer'));
    insert into public.domain_events (organization_id, location_id, type, aggregate_type, aggregate_id, payload, actor_user_id, actor_label)
    values (t.organization_id, t.location_id, 'inventory.adjusted', 'inventory_item', t.id,
            jsonb_build_object('name', t.name, 'type', 'transfer', 'quantity', v_mag, 'unit', t.unit, 'from', t.quantity, 'to', t.quantity + v_mag), v_uid, v_label);
    insert into public.audit_logs (organization_id, location_id, actor_user_id, actor_label, action, entity_type, entity_id, before_data, after_data, metadata)
    values (t.organization_id, t.location_id, v_uid, v_label, 'inventory.adjusted', 'inventory_item', t.id,
            jsonb_build_object('quantity', t.quantity), jsonb_build_object('quantity', t.quantity + v_mag),
            jsonb_build_object('type', 'transfer', 'quantity', v_mag, 'note', v_note, 'name', t.name, 'unit', t.unit));
  end if;
  perform set_config('cornerops.inventory_write', 'off', true);

  return jsonb_build_object('id', i.id, 'quantity', i.quantity + v_signed);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: no direct writes to operational tables by application users.

revoke insert, update, delete on public.orders, public.order_items, public.kitchen_tickets, public.customers,
  public.inventory_items, public.inventory_movements, public.audit_logs from authenticated;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists order_items_insert on public.order_items;
drop policy if exists customers_write on public.customers;
drop policy if exists inventory_items_write on public.inventory_items;
drop policy if exists inventory_movements_insert on public.inventory_movements;
drop policy if exists audit_logs_insert on public.audit_logs;

revoke all on function private.consume_order_inventory(text, uuid, text), private.emit_stock_level_events(text, text, text, text, text, numeric, numeric, numeric, uuid, text, jsonb),
  private.guard_order_update(), private.guard_inventory_update() from public, authenticated, anon;
revoke all on function public.apply_order_transition(text, text, text, text, jsonb, text, jsonb),
  public.apply_order_inventory_usage(text, text), public.record_inventory_movement(text, text, numeric, text, text) from public, anon;
grant execute on function public.apply_order_transition(text, text, text, text, jsonb, text, jsonb),
  public.apply_order_inventory_usage(text, text), public.record_inventory_movement(text, text, numeric, text, text) to authenticated;

commit;
