-- CornerOps One v0.2.1 — tenant relationship integrity
--
-- Composite, tenant-aware foreign keys so a row can never reference a parent
-- (location, restaurant, order, item, membership …) that belongs to another
-- organization, and an order item / movement can never disagree with its
-- parent's location. Additive only: existing single-column FKs keep their
-- ON DELETE behaviour; new constraints are added NOT VALID and then validated,
-- so existing valid data is preserved and invalid data is reported, not deleted.

begin;

-- Parent keys ---------------------------------------------------------------
alter table public.restaurants add constraint restaurants_org_id_key unique (organization_id, id);
alter table public.locations add constraint locations_org_id_key unique (organization_id, id);
alter table public.organization_memberships add constraint memberships_org_id_key unique (organization_id, id);
alter table public.customers add constraint customers_org_id_key unique (organization_id, id);
alter table public.orders add constraint orders_org_id_key unique (organization_id, id);
alter table public.orders add constraint orders_id_location_key unique (id, location_id);
alter table public.menu_categories add constraint menu_categories_org_id_key unique (organization_id, id);
alter table public.menu_items add constraint menu_items_org_id_key unique (organization_id, id);
alter table public.inventory_items add constraint inventory_items_org_id_key unique (organization_id, id);
alter table public.inventory_items add constraint inventory_items_id_location_key unique (id, location_id);
alter table public.channel_connections add constraint channel_connections_org_id_key unique (organization_id, id);

-- Child references ------------------------------------------------------------
alter table public.locations
  add constraint locations_restaurant_same_org foreign key (organization_id, restaurant_id) references public.restaurants (organization_id, id) not valid;

alter table public.membership_locations
  add constraint membership_locations_membership_same_org foreign key (organization_id, membership_id) references public.organization_memberships (organization_id, id) on delete cascade not valid,
  add constraint membership_locations_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade not valid;

alter table public.orders
  add constraint orders_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) not valid,
  add constraint orders_restaurant_same_org foreign key (organization_id, restaurant_id) references public.restaurants (organization_id, id) not valid,
  add constraint orders_customer_same_org foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete set null (customer_id) not valid;

alter table public.order_items
  add constraint order_items_order_same_org foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete cascade not valid,
  add constraint order_items_order_same_location foreign key (order_id, location_id) references public.orders (id, location_id) on delete cascade not valid,
  add constraint order_items_menu_item_same_org foreign key (organization_id, menu_item_id) references public.menu_items (organization_id, id) on delete set null (menu_item_id) not valid;

alter table public.kitchen_tickets
  add constraint kitchen_tickets_order_same_location foreign key (order_id, location_id) references public.orders (id, location_id) on delete cascade not valid,
  add constraint kitchen_tickets_order_same_org foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete cascade not valid;

alter table public.menu_items
  add constraint menu_items_category_same_org foreign key (organization_id, category_id) references public.menu_categories (organization_id, id) not valid;

alter table public.menu_channel_mappings
  add constraint menu_mappings_item_same_org foreign key (organization_id, menu_item_id) references public.menu_items (organization_id, id) on delete cascade not valid;

alter table public.inventory_items
  add constraint inventory_items_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade not valid;

alter table public.inventory_movements
  add constraint inventory_movements_item_same_org foreign key (organization_id, inventory_item_id) references public.inventory_items (organization_id, id) on delete cascade not valid,
  add constraint inventory_movements_item_same_location foreign key (inventory_item_id, location_id) references public.inventory_items (id, location_id) on delete cascade not valid,
  add constraint inventory_movements_order_same_org foreign key (organization_id, order_id) references public.orders (organization_id, id) on delete set null (order_id) not valid;

alter table public.channel_connections
  add constraint channel_connections_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade not valid;

alter table public.channel_logs
  add constraint channel_logs_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade not valid;

alter table public.alerts
  add constraint alerts_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade not valid;

alter table public.daily_metrics
  add constraint daily_metrics_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete cascade not valid;

alter table public.domain_events
  add constraint domain_events_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete set null (location_id) not valid;

alter table public.audit_logs
  add constraint audit_logs_location_same_org foreign key (organization_id, location_id) references public.locations (organization_id, id) on delete set null (location_id) not valid;

-- Validate (fails the migration — without deleting anything — if existing rows violate tenancy).
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname from pg_constraint
    where contype = 'f' and not convalidated and connamespace = 'public'::regnamespace
  loop
    execute format('alter table %s validate constraint %I', r.tbl, r.conname);
  end loop;
end $$;

commit;
