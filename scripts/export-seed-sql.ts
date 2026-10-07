/**
 * Exports the CornerOps demo dataset as Postgres INSERTs (supabase/seed.sql).
 * Uses the exact generator the app runs on, so both stores hold the same data.
 *
 *   npm run db:seed:export
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { computeAlerts } from "@/domain/alerts/engine";
import { prepMinutes } from "@/domain/analytics/metrics";
import { CHANNEL_CATALOG, ORDER_CHANNELS } from "@/domain/channels/types";
import { usageRates } from "@/domain/inventory/forecast";
import { computeSla } from "@/domain/orders/sla";
import { ACTIVE_STATUSES, type UnifiedOrder } from "@/domain/orders/types";
import { DAY, HOUR, dubaiDateKey, startOfDubaiDay, toMs } from "@/lib/time";
import { generateDemoDatabase } from "@/server/seed/generate";

/** Marks a value to be written as jsonb (vs text[] for plain string arrays). */
class Json {
  constructor(public readonly value: unknown) {}
}
const json = (v: unknown) => new Json(v);

type Value = string | number | boolean | null | undefined | string[] | Json;

function lit(v: Value): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Json) return `${lit(JSON.stringify(v.value))}::jsonb`;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
    return `array[${(v as string[]).map((x) => lit(x)).join(", ")}]::text[]`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insert(table: string, rows: Record<string, Value>[], chunk = 400): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const values = rows
      .slice(i, i + chunk)
      .map((r) => `(${cols.map((c) => lit(r[c])).join(", ")})`)
      .join(",\n  ");
    out.push(`insert into public.${table} (${cols.join(", ")}) values\n  ${values};`);
  }
  return out.join("\n") + "\n\n";
}

const now = Date.now();
const db = generateDemoDatabase(now);
const org = db.organization.id;

let sql = `-- CornerOps Restaurant OS · demo seed (generated ${new Date(now).toISOString()})
-- Organization: ${db.organization.name} · Restaurant: ${db.restaurant.name}
-- Regenerate with: npm run db:seed:export

begin;

`;

sql += insert("organizations", [{ ...pick(db.organization, ["id", "name", "slug", "currency", "timezone"]), created_at: db.organization.createdAt, updated_at: db.organization.updatedAt }]);
sql += insert("restaurants", [{ id: db.restaurant.id, organization_id: org, name: db.restaurant.name, cuisine: db.restaurant.cuisine, created_at: db.restaurant.createdAt, updated_at: db.restaurant.updatedAt }]);
sql += insert(
  "locations",
  db.locations.map((l) => ({
    id: l.id, organization_id: org, restaurant_id: l.restaurantId, name: l.name, code: l.code, area: l.area, address: l.address,
    open_time: l.operatingHours.open, close_time: l.operatingHours.close, kitchen_capacity: l.kitchenCapacity, manager_name: l.managerName,
    is_open: l.isOpen, created_at: l.createdAt, updated_at: l.updatedAt,
  })),
);
sql += insert(
  "users",
  db.users.map((u) => ({
    id: u.id, organization_id: org, name: u.name, email: u.email, role: u.role,
    location_ids: u.locationIds === "all" ? null : u.locationIds, created_at: u.createdAt, updated_at: u.updatedAt,
  })),
);
sql += insert("organization_settings", [{ organization_id: org, sla: json(db.settings.sla), economics: json(db.settings.economics), demo: json(db.settings.demo), ai_provider: db.settings.aiProvider }]);
sql += insert("channels", ORDER_CHANNELS.map((c) => ({ id: c, name: CHANNEL_CATALOG[c].name, kind: CHANNEL_CATALOG[c].kind })));
sql += insert(
  "channel_connections",
  db.channelConnections.map((c) => ({
    id: c.id, organization_id: org, location_id: c.locationId, channel_id: c.channel, external_store_id: c.externalStoreId, status: c.status,
    mode: c.mode, latency_ms: c.latencyMs, last_sync_at: c.lastSyncAt, error_count: c.errorCount, message: c.message ?? null,
    created_at: c.createdAt, updated_at: c.updatedAt,
  })),
);
sql += insert(
  "channel_logs",
  db.channelLogs.map((l) => ({ id: l.id, organization_id: org, location_id: l.locationId ?? null, channel_id: l.channel, level: l.level, message: l.message, created_at: l.at })),
);
sql += insert(
  "customers",
  db.customers.map((c) => ({ id: c.id, organization_id: org, name: c.name, phone: c.phone, area: c.area, first_order_at: c.firstOrderAt, created_at: c.createdAt, updated_at: c.updatedAt })),
);
sql += insert(
  "menu_categories",
  db.menuCategories.map((c) => ({ id: c.id, organization_id: org, name: c.name, sort_order: c.sortOrder, created_at: c.createdAt, updated_at: c.updatedAt })),
);
sql += insert(
  "menu_items",
  db.menuItems.map((m) => ({
    id: m.id, organization_id: org, category_id: m.categoryId, name: m.name, description: m.description, sku: m.sku, price: m.price,
    food_cost: m.foodCost, is_available: m.isAvailable, prep_time_minutes: m.prepTimeMinutes, tax_rate: m.taxRate, image_emoji: m.imageEmoji,
    popularity: m.popularity, tags: m.tags, created_at: m.createdAt, updated_at: m.updatedAt,
  })),
);
sql += insert(
  "menu_item_recipes",
  db.menuItems.flatMap((m) => m.recipe.map((r) => ({ menu_item_id: m.id, ingredient_key: r.inventoryItemKey, quantity: r.quantity }))),
);
sql += insert(
  "menu_channel_mappings",
  db.menuMappings.map((m) => ({
    id: m.id, organization_id: org, menu_item_id: m.menuItemId, channel_id: m.channel, external_item_id: m.externalItemId, external_name: m.externalName,
    channel_price: m.channelPrice, status: m.status, last_synced_at: m.lastSyncedAt, message: m.message ?? null, created_at: m.createdAt, updated_at: m.updatedAt,
  })),
);
sql += insert(
  "orders",
  db.orders.map((o) => ({
    id: o.id, organization_id: org, restaurant_id: o.restaurantId, location_id: o.locationId, order_number: o.orderNumber, external_order_id: o.externalOrderId,
    channel_id: o.channel, status: o.status, fulfillment: o.fulfillment, customer_id: o.customer?.id ?? null, customer_name: o.customer?.name ?? null,
    customer_phone: o.customer?.phone ?? null, subtotal: o.subtotal, discount: o.discount, delivery_fee: o.deliveryFee, platform_fee: o.platformFee ?? null,
    tax: o.tax, total: o.total, payment_method: o.paymentMethod, estimated_prep_minutes: o.estimatedPrepMinutes, notes: o.notes ?? null,
    courier: o.courier ? json(o.courier) : null, placed_at: o.placedAt, accepted_at: o.acceptedAt, preparation_started_at: o.preparationStartedAt,
    ready_at: o.readyAt, picked_up_at: o.pickedUpAt, completed_at: o.completedAt, cancelled_at: o.cancelledAt, cancellation_reason: o.cancellationReason ?? null,
    sync_status: o.syncStatus, source: o.source, metadata: json(o.metadata ?? {}), created_at: o.createdAt, updated_at: o.updatedAt,
  })),
);
sql += insert(
  "order_items",
  db.orders.flatMap((o) =>
    o.items.map((i) => ({
      id: i.id, organization_id: org, order_id: o.id, menu_item_id: i.menuItemId ?? null, external_item_id: i.externalItemId ?? null, name: i.name,
      quantity: i.quantity, unit_price: i.unitPrice, modifiers: json(i.modifiers), notes: i.notes ?? null, total: i.total, created_at: o.createdAt, updated_at: o.updatedAt,
    })),
  ),
);

// Kitchen tickets for orders currently in the kitchen.
const kitchenStatus = (o: UnifiedOrder) => (o.status === "new" || o.status === "accepted" ? "queued" : o.status === "preparing" ? "in_progress" : "ready");
sql += insert(
  "kitchen_tickets",
  db.orders
    .filter((o) => ACTIVE_STATUSES.includes(o.status))
    .map((o, i) => ({
      id: `kt_${i + 1}`, organization_id: org, location_id: o.locationId, order_id: o.id, status: kitchenStatus(o),
      priority: computeSla(o, now, db.settings.sla).level, fired_at: o.acceptedAt ?? null, ready_at: o.readyAt ?? null, bumped_at: null,
      created_at: o.placedAt, updated_at: o.updatedAt,
    })),
);

sql += insert(
  "inventory_items",
  db.inventoryItems.map((i) => ({
    id: i.id, organization_id: org, location_id: i.locationId, ingredient_key: i.key, name: i.name, category: i.category, unit: i.unit,
    quantity: i.quantity, threshold: i.threshold, par_level: i.parLevel, unit_cost: i.unitCost, supplier: i.supplier, created_at: i.createdAt, updated_at: i.updatedAt,
  })),
);
sql += insert(
  "inventory_movements",
  db.inventoryMovements.map((m) => ({
    id: m.id, organization_id: org, location_id: m.locationId, inventory_item_id: m.inventoryItemId, type: m.type, quantity: m.quantity,
    note: m.note ?? null, order_id: m.orderId ?? null, created_by: m.createdBy, created_at: m.createdAt, updated_at: m.updatedAt,
  })),
);

// Alerts: the conditions true at seed time.
const todayStart = startOfDubaiDay(now);
const inRange = (o: UnifiedOrder, a: number, b: number) => {
  const t = toMs(o.placedAt)!;
  return t >= a && t < b;
};
const alerts = computeAlerts({
  organizationId: org,
  now,
  locations: db.locations,
  ordersToday: db.orders.filter((o) => inRange(o, todayStart, now + 1)),
  ordersBaseline: db.orders.filter((o) => inRange(o, todayStart - 7 * DAY, todayStart)),
  inventory: db.inventoryItems,
  usageRates: usageRates(db.orders.filter((o) => inRange(o, now - 4 * HOUR, now + 1)), db.menuItems, now),
  menuItems: db.menuItems,
  connections: db.channelConnections,
  mappings: db.menuMappings,
  sla: db.settings.sla,
});
sql += insert(
  "alerts",
  alerts.map((a) => ({
    id: a.id, organization_id: org, location_id: a.locationId ?? null, channel_id: a.channel ?? null, severity: a.severity, category: a.category,
    title: a.title, detail: a.detail, href: a.href,
  })),
);

// Daily metrics rollup per location × channel × Dubai date.
const metrics = new Map<string, { location: string; channel: string; date: string; orders: number; cancelled: number; gross: number; disc: number; fees: number; prepSum: number; prepN: number }>();
for (const o of db.orders) {
  const date = dubaiDateKey(toMs(o.placedAt)!);
  const key = `${o.locationId}|${o.channel}|${date}`;
  const m = metrics.get(key) ?? { location: o.locationId, channel: o.channel, date, orders: 0, cancelled: 0, gross: 0, disc: 0, fees: 0, prepSum: 0, prepN: 0 };
  m.orders += 1;
  if (o.status === "cancelled") m.cancelled += 1;
  else {
    m.gross += o.subtotal;
    m.disc += o.discount;
    m.fees += o.platformFee ?? 0;
    const p = prepMinutes(o);
    if (p !== undefined) {
      m.prepSum += p;
      m.prepN += 1;
    }
  }
  metrics.set(key, m);
}
sql += insert(
  "daily_metrics",
  [...metrics.values()].map((m, i) => ({
    id: `dm_${i + 1}`, organization_id: org, location_id: m.location, channel_id: m.channel, metric_date: m.date, orders: m.orders,
    cancelled_orders: m.cancelled, gross_sales: round(m.gross), discounts: round(m.disc), net_sales: round(m.gross - m.disc),
    platform_fees: round(m.fees), avg_prep_minutes: m.prepN ? round(m.prepSum / m.prepN) : null,
  })),
);

sql += "commit;\n";

function round(v: number) {
  return Math.round(v * 100) / 100;
}
function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;
}

const target = resolve(process.cwd(), "supabase/seed.sql");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, sql);
console.log(
  `Wrote ${target}\n  ${db.orders.length} orders · ${db.orders.reduce((s, o) => s + o.items.length, 0)} order items · ${db.menuItems.length} menu items · ${db.inventoryItems.length} inventory items · ${db.customers.length} customers · ${alerts.length} alerts · ${metrics.size} daily metric rows`,
);
