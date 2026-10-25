import type { Db } from "../db/client";
import { chunk } from "../repositories/mappers";
import { movementRow } from "../repositories/inventory";
import { orderItemRows, orderRow } from "../repositories/orders";
import type { Database } from "../store/types";

/**
 * Write a generated workspace (the deterministic Casa Norte dataset) into
 * Postgres. Used for the Demo Workspace and for local fixture organizations.
 * Runs in a system transaction.
 */
export async function persistWorkspace(db: Db, w: Database) {
  const org = w.organization.id;
  // Seeding is not a user change: suspend row-level configuration audit (honoured only for system connections).
  await db`select set_config('cornerops.audit_suspended', 'on', true)`;
  const insert = async (table: string, rows: Record<string, unknown>[], size = 1000) => {
    for (const batch of chunk(rows, size)) await db`insert into ${db(table)} ${db(batch)}`;
  };

  await insert("organizations", [
    { id: org, name: w.organization.name, slug: w.organization.slug, currency: w.organization.currency, timezone: w.organization.timezone, is_demo: w.organization.isDemo, created_at: w.organization.createdAt, updated_at: w.organization.updatedAt },
  ]);
  await insert("restaurants", [{ id: w.restaurant.id, organization_id: org, name: w.restaurant.name, cuisine: w.restaurant.cuisine, created_at: w.restaurant.createdAt, updated_at: w.restaurant.updatedAt }]);
  await insert(
    "locations",
    w.locations.map((l) => ({
      id: l.id, organization_id: org, restaurant_id: l.restaurantId, name: l.name, code: l.code, area: l.area, address: l.address,
      open_time: l.operatingHours.open, close_time: l.operatingHours.close, kitchen_capacity: l.kitchenCapacity, manager_name: l.managerName,
      is_open: l.isOpen, created_at: l.createdAt, updated_at: l.updatedAt,
    })),
  );
  await db`insert into public.organization_settings (organization_id, sla, economics, demo, ai_provider)
           values (${org}, ${db.json(w.settings.sla as never)}, ${db.json(w.settings.economics as never)}, ${db.json(w.settings.demo as never)}, ${w.settings.aiProvider})`;
  await db`insert into public.organization_counters (organization_id, next_order_number) values (${org}, ${w.counters.orderNumber + 1})`;
  await insert(
    "channel_connections",
    w.channelConnections.map((c) => ({
      id: c.id, organization_id: org, location_id: c.locationId, channel_id: c.channel, external_store_id: c.externalStoreId, status: c.status,
      mode: c.mode, latency_ms: c.latencyMs, last_sync_at: c.lastSyncAt, error_count: c.errorCount, message: c.message ?? null,
      created_at: c.createdAt, updated_at: c.updatedAt,
    })),
  );
  await insert(
    "channel_logs",
    w.channelLogs.map((l) => ({ id: l.id, organization_id: org, location_id: l.locationId ?? null, channel_id: l.channel, level: l.level, message: l.message, created_at: l.at })),
  );
  await insert(
    "customers",
    w.customers.map((c) => ({ id: c.id, organization_id: org, name: c.name, phone: c.phone, area: c.area, first_order_at: c.firstOrderAt, created_at: c.createdAt, updated_at: c.updatedAt })),
  );
  await insert(
    "menu_categories",
    w.menuCategories.map((c) => ({ id: c.id, organization_id: org, name: c.name, sort_order: c.sortOrder, created_at: c.createdAt, updated_at: c.updatedAt })),
  );
  await insert(
    "menu_items",
    w.menuItems.map((m) => ({
      id: m.id, organization_id: org, category_id: m.categoryId, name: m.name, description: m.description, sku: m.sku, price: m.price,
      food_cost: m.foodCost, is_available: m.isAvailable, prep_time_minutes: m.prepTimeMinutes, tax_rate: m.taxRate, image_emoji: m.imageEmoji,
      popularity: m.popularity, tags: m.tags, created_at: m.createdAt, updated_at: m.updatedAt,
    })),
  );
  await insert(
    "menu_item_recipes",
    w.menuItems.flatMap((m) => m.recipe.map((r) => ({ menu_item_id: m.id, ingredient_key: r.inventoryItemKey, quantity: r.quantity }))),
  );
  await insert(
    "menu_channel_mappings",
    w.menuMappings.map((m) => ({
      id: m.id, organization_id: org, menu_item_id: m.menuItemId, channel_id: m.channel, external_item_id: m.externalItemId,
      external_name: m.externalName, channel_price: m.channelPrice, status: m.status, last_synced_at: m.lastSyncedAt,
      message: m.message ?? null, created_at: m.createdAt, updated_at: m.updatedAt,
    })),
  );
  await insert(
    "inventory_items",
    w.inventoryItems.map((i) => ({
      id: i.id, organization_id: org, location_id: i.locationId, ingredient_key: i.key, name: i.name, category: i.category, unit: i.unit,
      quantity: i.quantity, threshold: i.threshold, par_level: i.parLevel, unit_cost: i.unitCost, supplier: i.supplier,
      created_at: i.createdAt, updated_at: i.updatedAt,
    })),
  );
  await insert("orders", w.orders.map(orderRow), 500);
  await insert("order_items", w.orders.flatMap((o) => orderItemRows(o, (v) => db.json(v as never))));
  await insert("inventory_movements", w.inventoryMovements.map(movementRow));
  await db`select set_config('cornerops.audit_suspended', 'off', true)`;
}

const CATALOG_ID = /"((?:org|rst|loc|itm|cat|inv|conn|map|cus)_[A-Za-z0-9_]+)"/g;

/**
 * Give a generated workspace its own identity so several organizations built
 * from the same catalog can coexist (catalog ids like "loc_marina" are fixed).
 */
export function namespaceWorkspace(w: Database, ns: { prefix: string; organizationId: string; name: string; slug: string; isDemo: boolean }): Database {
  const json = JSON.stringify({ ...w, ordersById: undefined, acknowledgedAlerts: undefined, alertFirstSeen: undefined });
  const rewritten = json.replace(CATALOG_ID, (_m, id: string) =>
    id === w.organization.id ? `"${ns.organizationId}"` : `"${ns.prefix}${id}"`,
  );
  const out = JSON.parse(rewritten) as Database;
  out.organization = { ...out.organization, name: ns.name, slug: ns.slug, isDemo: ns.isDemo };
  out.ordersById = new Map(out.orders.map((o) => [o.id, o]));
  out.acknowledgedAlerts = new Set();
  out.alertFirstSeen = new Map();
  return out;
}
