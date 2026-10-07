-- CornerOps Restaurant OS — initial schema (v0.1)
--
-- Multi-tenant by design: every operational row carries organization_id (and
-- location_id where it applies). Row Level Security scopes access to the
-- organization in the caller's JWT (app_metadata.organization_id).
--
-- Text primary keys keep IDs stable between the in-memory demo store and
-- Postgres (e.g. "loc_marina", "ord_1a2"). Money is numeric(12,2) in AED.

begin;

-- ---------------------------------------------------------------------------
-- Helpers

create or replace function public.current_organization_id()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb
      -> 'app_metadata' ->> 'organization_id',
    ''
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenancy & organization

create table public.organizations (
  id          text primary key,
  name        text not null,
  slug        text not null unique,
  currency    text not null default 'AED',
  timezone    text not null default 'Asia/Dubai',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.users (
  id              text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  auth_user_id    uuid unique,                -- links to auth.users when real auth is enabled
  name            text not null,
  email           text not null,
  role            text not null check (role in ('owner', 'general_manager', 'branch_manager', 'kitchen_manager')),
  location_ids    text[],                     -- null = all locations
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.restaurants (
  id              text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name            text not null,
  cuisine         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.locations (
  id               text primary key,
  organization_id  text not null references public.organizations (id) on delete cascade,
  restaurant_id    text not null references public.restaurants (id) on delete cascade,
  name             text not null,
  code             text not null,
  area             text,
  address          text,
  open_time        time not null,
  close_time       time not null,
  kitchen_capacity integer not null default 10 check (kitchen_capacity > 0),
  manager_name     text,
  is_open          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.organization_settings (
  organization_id text primary key references public.organizations (id) on delete cascade,
  sla             jsonb not null,
  economics       jsonb not null,             -- per-channel commercial terms
  demo            jsonb not null,
  ai_provider     text not null default 'deterministic',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Channels

create table public.channels (
  id         text primary key,                -- talabat | deliveroo | noon | keeta | direct | whatsapp
  name       text not null,
  kind       text not null check (kind in ('marketplace', 'owned')),
  created_at timestamptz not null default now()
);

create table public.channel_connections (
  id                text primary key,
  organization_id   text not null references public.organizations (id) on delete cascade,
  location_id       text not null references public.locations (id) on delete cascade,
  channel_id        text not null references public.channels (id),
  external_store_id text not null,
  status            text not null check (status in ('connected', 'degraded', 'disconnected')),
  mode              text not null default 'mock' check (mode in ('mock', 'live')),
  latency_ms        integer not null default 0,
  last_sync_at      timestamptz,
  error_count       integer not null default 0,
  message           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (channel_id, external_store_id),
  unique (location_id, channel_id)
);

create table public.channel_logs (
  id              text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  location_id     text references public.locations (id) on delete cascade,
  channel_id      text not null references public.channels (id),
  level           text not null check (level in ('info', 'warning', 'error')),
  message         text not null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers & orders (UnifiedOrder)

create table public.customers (
  id              text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name            text not null,
  phone           text,
  area            text,
  first_order_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.orders (
  id                      text primary key,
  organization_id         text not null references public.organizations (id) on delete cascade,
  restaurant_id           text not null references public.restaurants (id),
  location_id             text not null references public.locations (id),
  order_number            text not null,
  external_order_id       text not null,
  channel_id              text not null references public.channels (id),
  status                  text not null check (status in ('new', 'accepted', 'preparing', 'ready', 'picked_up', 'completed', 'cancelled')),
  fulfillment             text not null check (fulfillment in ('delivery', 'pickup')),
  customer_id             text references public.customers (id) on delete set null,
  customer_name           text,
  customer_phone          text,
  subtotal                numeric(12, 2) not null,
  discount                numeric(12, 2) not null default 0,
  delivery_fee            numeric(12, 2) not null default 0,
  platform_fee            numeric(12, 2),
  tax                     numeric(12, 2) not null default 0,
  total                   numeric(12, 2) not null,
  payment_method          text not null,
  estimated_prep_minutes  integer not null,
  notes                   text,
  courier                 jsonb,
  placed_at               timestamptz not null,
  accepted_at             timestamptz,
  preparation_started_at  timestamptz,
  ready_at                timestamptz,
  picked_up_at            timestamptz,
  completed_at            timestamptz,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  sync_status             text not null default 'synced' check (sync_status in ('synced', 'pending', 'failed')),
  source                  text not null check (source in ('mock', 'live', 'seed')),
  metadata                jsonb not null default '{}'::jsonb,   -- channel-specific fields live here
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, order_number),
  unique (channel_id, external_order_id)
);

create index orders_org_location_placed_idx on public.orders (organization_id, location_id, placed_at desc);
create index orders_active_idx on public.orders (organization_id, status) where status in ('new', 'accepted', 'preparing', 'ready');
create index orders_channel_placed_idx on public.orders (organization_id, channel_id, placed_at desc);

create table public.order_items (
  id               text primary key,
  organization_id  text not null references public.organizations (id) on delete cascade,
  order_id         text not null references public.orders (id) on delete cascade,
  menu_item_id     text,
  external_item_id text,
  name             text not null,
  quantity         integer not null check (quantity > 0),
  unit_price       numeric(12, 2) not null,
  modifiers        jsonb not null default '[]'::jsonb,
  notes            text,
  total            numeric(12, 2) not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);

create table public.kitchen_tickets (
  id              text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  location_id     text not null references public.locations (id),
  order_id        text not null unique references public.orders (id) on delete cascade,
  status          text not null check (status in ('queued', 'in_progress', 'ready', 'bumped')),
  priority        text not null default 'normal' check (priority in ('normal', 'warning', 'critical')),
  fired_at        timestamptz,
  ready_at        timestamptz,
  bumped_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index kitchen_tickets_board_idx on public.kitchen_tickets (organization_id, location_id, status);

-- ---------------------------------------------------------------------------
-- Menu

create table public.menu_categories (
  id              text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  name            text not null,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.menu_items (
  id                text primary key,
  organization_id   text not null references public.organizations (id) on delete cascade,
  category_id       text not null references public.menu_categories (id),
  name              text not null,
  description       text,
  sku               text not null,
  price             numeric(12, 2) not null check (price >= 0),
  food_cost         numeric(12, 2) not null default 0,
  is_available      boolean not null default true,
  prep_time_minutes integer not null default 10,
  tax_rate          numeric(5, 4) not null default 0.05,
  image_emoji       text,
  popularity        integer not null default 1,
  tags              text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, sku)
);

alter table public.order_items
  add constraint order_items_menu_item_fk foreign key (menu_item_id) references public.menu_items (id) on delete set null;

create table public.menu_item_recipes (
  menu_item_id   text not null references public.menu_items (id) on delete cascade,
  ingredient_key text not null,
  quantity       numeric(12, 4) not null check (quantity > 0),
  primary key (menu_item_id, ingredient_key)
);

create table public.menu_channel_mappings (
  id               text primary key,
  organization_id  text not null references public.organizations (id) on delete cascade,
  menu_item_id     text not null references public.menu_items (id) on delete cascade,
  channel_id       text not null references public.channels (id),
  external_item_id text,
  external_name    text,
  channel_price    numeric(12, 2),
  status           text not null check (status in ('synced', 'pending', 'out_of_sync', 'missing', 'error')),
  last_synced_at   timestamptz,
  message          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (menu_item_id, channel_id)
);

-- ---------------------------------------------------------------------------
-- Inventory

create table public.inventory_items (
  id              text primary key,
  organization_id text not null references public.organizations (id) on delete cascade,
  location_id     text not null references public.locations (id) on delete cascade,
  ingredient_key  text not null,
  name            text not null,
  category        text,
  unit            text not null check (unit in ('kg', 'L', 'pcs', 'bunch')),
  quantity        numeric(12, 3) not null check (quantity >= 0),
  threshold       numeric(12, 3) not null,
  par_level       numeric(12, 3) not null,
  unit_cost       numeric(12, 2) not null default 0,
  supplier        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (location_id, ingredient_key)
);

create table public.inventory_movements (
  id                text primary key,
  organization_id   text not null references public.organizations (id) on delete cascade,
  location_id       text not null references public.locations (id) on delete cascade,
  inventory_item_id text not null references public.inventory_items (id) on delete cascade,
  type              text not null check (type in ('purchase', 'usage', 'adjustment', 'waste', 'transfer')),
  quantity          numeric(12, 3) not null,       -- signed change
  note              text,
  order_id          text references public.orders (id) on delete set null,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index inventory_movements_item_idx on public.inventory_movements (inventory_item_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Alerts & metrics

create table public.alerts (
  id               text primary key,
  organization_id  text not null references public.organizations (id) on delete cascade,
  location_id      text references public.locations (id) on delete cascade,
  channel_id       text references public.channels (id),
  severity         text not null check (severity in ('info', 'warning', 'critical')),
  category         text not null check (category in ('inventory', 'kitchen', 'channel', 'orders', 'menu')),
  title            text not null,
  detail           text,
  href             text,
  acknowledged_at  timestamptz,
  acknowledged_by  text references public.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index alerts_open_idx on public.alerts (organization_id, created_at desc) where acknowledged_at is null;

create table public.daily_metrics (
  id                 text primary key,
  organization_id    text not null references public.organizations (id) on delete cascade,
  location_id        text not null references public.locations (id) on delete cascade,
  channel_id         text not null references public.channels (id),
  metric_date        date not null,                -- restaurant-local (Asia/Dubai) date
  orders             integer not null default 0,
  cancelled_orders   integer not null default 0,
  gross_sales        numeric(14, 2) not null default 0,
  discounts          numeric(14, 2) not null default 0,
  net_sales          numeric(14, 2) not null default 0,
  platform_fees      numeric(14, 2) not null default 0,
  avg_prep_minutes   numeric(6, 2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (location_id, channel_id, metric_date)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'users', 'restaurants', 'locations', 'organization_settings', 'channel_connections',
    'customers', 'orders', 'order_items', 'kitchen_tickets', 'menu_categories', 'menu_items',
    'menu_channel_mappings', 'inventory_items', 'inventory_movements', 'alerts', 'daily_metrics'
  ] loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: tenants only see their own organization.

alter table public.channels enable row level security;
create policy channels_read on public.channels for select using (true);

do $$
declare t text;
begin
  foreach t in array array[
    'users', 'restaurants', 'locations', 'organization_settings', 'channel_connections', 'channel_logs',
    'customers', 'orders', 'order_items', 'kitchen_tickets', 'menu_categories', 'menu_items',
    'menu_channel_mappings', 'inventory_items', 'inventory_movements', 'alerts', 'daily_metrics'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all using (organization_id = public.current_organization_id()) with check (organization_id = public.current_organization_id())',
      t || '_tenant_isolation', t
    );
  end loop;
end $$;

alter table public.organizations enable row level security;
create policy organizations_tenant_isolation on public.organizations
  for select using (id = public.current_organization_id());

alter table public.menu_item_recipes enable row level security;
create policy menu_item_recipes_tenant_isolation on public.menu_item_recipes
  for all using (exists (
    select 1 from public.menu_items m
    where m.id = menu_item_id and m.organization_id = public.current_organization_id()
  ));

commit;
