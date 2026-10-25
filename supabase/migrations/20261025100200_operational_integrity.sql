-- CornerOps One v0.2 — operational integrity
--
-- Idempotency for channel orders, per-organization uniqueness, persistent
-- kitchen state, atomic inventory consumption, safe channel credential
-- references, demo workspace state and supporting indexes.

begin;

-- ---------------------------------------------------------------------------
-- Idempotency: one CornerOps order per (organization, channel, external id).
-- Marketplace webhooks may be delivered more than once.

alter table public.orders drop constraint if exists orders_channel_id_external_order_id_key;
alter table public.orders
  add constraint orders_external_identity_key unique (organization_id, channel_id, external_order_id);

-- Store identifiers are unique per organization (two tenants may share codes).
alter table public.channel_connections drop constraint if exists channel_connections_channel_id_external_store_id_key;
alter table public.channel_connections
  add constraint channel_connections_external_store_key unique (organization_id, channel_id, external_store_id);

-- Future live integrations reference credentials held in a secrets manager.
-- Plaintext secrets are never stored in this table.
alter table public.channel_connections
  add column if not exists credential_reference text,
  add constraint channel_connections_credential_reference_format
    check (credential_reference is null or credential_reference ~ '^(vault|secretsmanager|env)://[A-Za-z0-9_./:-]+$');

comment on column public.channel_connections.credential_reference is
  'Pointer to a secret in a server-side secrets store (e.g. vault://cornerops/talabat/<store>). Never a credential value.';

-- ---------------------------------------------------------------------------
-- Order items carry their location so location-scoped access is cheap to enforce.

alter table public.order_items add column if not exists location_id text references public.locations (id);
update public.order_items oi set location_id = o.location_id from public.orders o where o.id = oi.order_id and oi.location_id is null;
alter table public.order_items alter column location_id set not null;
create index if not exists order_items_location_idx on public.order_items (location_id);

-- Per-organization order numbering (CO-xxxxx).
create table public.organization_counters (
  organization_id    text primary key references public.organizations (id) on delete cascade,
  next_order_number  bigint not null default 10001
);

create or replace function public.reserve_order_numbers(p_organization_id text, p_count integer)
returns bigint
language sql
as $$
  insert into public.organization_counters as c (organization_id, next_order_number)
  values (p_organization_id, 10001 + p_count)
  on conflict (organization_id) do update set next_order_number = c.next_order_number + p_count
  returning next_order_number - p_count;
$$;

-- ---------------------------------------------------------------------------
-- Inventory movements: who, why, from which order.

alter table public.inventory_movements
  add column if not exists actor_user_id uuid references auth.users (id) on delete set null,
  add column if not exists actor_label text,
  add column if not exists reason text;
update public.inventory_movements set actor_label = coalesce(actor_label, created_by);
alter table public.inventory_movements drop column if exists created_by;
create index if not exists inventory_movements_org_created_idx on public.inventory_movements (organization_id, created_at desc);
create index if not exists inventory_movements_order_idx on public.inventory_movements (order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- Alerts are derived from live conditions; this table persists first-seen and
-- acknowledgement state per stable alert key.

alter table public.alerts add column if not exists alert_key text;
update public.alerts set alert_key = id where alert_key is null;
alter table public.alerts alter column alert_key set not null;
alter table public.alerts add constraint alerts_org_key unique (organization_id, alert_key);

-- ---------------------------------------------------------------------------
-- Demo workspace simulation state (only ever used for organizations.is_demo).

create table public.demo_workspace_state (
  organization_id   text primary key references public.organizations (id) on delete cascade,
  seed_version      text not null,
  seeded_at         timestamptz not null,
  last_tick_at      timestamptz not null default now(),
  next_order_at     timestamptz not null default now(),
  next_incident_at  timestamptz not null default now(),
  recoveries        jsonb not null default '[]'::jsonb,
  events            jsonb not null default '[]'::jsonb,
  inboxes           jsonb not null default '{}'::jsonb,   -- mock platform inboxes (orders queued while disconnected)
  external_sequence bigint not null default 100000,      -- mock platform payload sequence
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Kitchen tickets mirror order status in the same transaction (trigger), so the
-- kitchen board and order state can never drift apart.

create or replace function public.sync_kitchen_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.kitchen_tickets as kt (id, organization_id, location_id, order_id, status, priority, fired_at, ready_at, bumped_at, created_at)
  values (
    'kt_' || new.id,
    new.organization_id,
    new.location_id,
    new.id,
    case new.status
      when 'new' then 'queued'
      when 'accepted' then 'queued'
      when 'preparing' then 'in_progress'
      when 'ready' then 'ready'
      else 'bumped'
    end,
    'normal',
    coalesce(new.preparation_started_at, new.accepted_at),
    new.ready_at,
    case when new.status in ('picked_up', 'completed', 'cancelled') then coalesce(new.picked_up_at, new.cancelled_at, new.completed_at, now()) end,
    new.placed_at
  )
  on conflict (order_id) do update
    set status = excluded.status,
        fired_at = excluded.fired_at,
        ready_at = excluded.ready_at,
        bumped_at = excluded.bumped_at,
        updated_at = now();
  return new;
end;
$$;

create trigger orders_sync_kitchen_ticket
  after insert or update of status on public.orders
  for each row execute function public.sync_kitchen_ticket();

-- ---------------------------------------------------------------------------
-- Indexes for common workflows.

create index if not exists orders_org_status_idx on public.orders (organization_id, status);
create index if not exists orders_external_idx on public.orders (organization_id, external_order_id);
create index if not exists orders_org_placed_idx on public.orders (organization_id, placed_at desc);
create index if not exists inventory_items_org_location_idx on public.inventory_items (organization_id, location_id);
create index if not exists channel_logs_org_channel_idx on public.channel_logs (organization_id, channel_id, created_at desc);
create index if not exists customers_org_idx on public.customers (organization_id);
create index if not exists channel_connections_org_idx on public.channel_connections (organization_id, location_id);

commit;
