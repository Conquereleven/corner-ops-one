/**
 * Demo data generator for Casa Norte Mexican Kitchen.
 *
 * Every historical order is produced the same way a live one is: a customer
 * "places" it on a simulated platform (the mock adapter renders that
 * platform's payload), and the adapter's normalizer turns it into a
 * UnifiedOrder. The data is deterministic (fixed PRNG seed) and anchored to
 * the current time so "today" always looks like today.
 */
import { createMockAdapters } from "@/adapters/registry";
import type { ChannelConnection, OrderChannel } from "@/domain/channels/types";
import { CHANNEL_CATALOG, ORDER_CHANNELS } from "@/domain/channels/types";
import type { InventoryItem, InventoryMovement } from "@/domain/inventory/types";
import { recipeUsage } from "@/domain/inventory/usage";
import type { AppUser, Customer, Location } from "@/domain/locations/types";
import type { MenuChannelMapping, MenuItem } from "@/domain/menu/types";
import { DEFAULT_SLA } from "@/domain/orders/sla";
import type { OrderStatus, UnifiedOrder } from "@/domain/orders/types";
import { createRng, round2, type Rng } from "@/lib/rng";
import { DAY, HOUR, MINUTE, dubaiHour, iso, startOfDubaiDay, toMs } from "@/lib/time";
import { buildOrderSpec, pickChannel } from "../simulation/traffic";
import { createMockBackend, createNormalizationContext, newId } from "../store/backend";
import { finalizeIngestedOrder, insertOrder } from "../store/order-helpers";
import type { Database, WorkspaceSettings } from "../store/types";
import {
  CATEGORIES,
  CHANNEL_BEHAVIOUR,
  CUSTOMER_AREAS,
  EXTERNAL_ITEM_ID,
  FIRST_NAMES,
  HOURLY_WEIGHTS,
  INGREDIENTS,
  LAST_NAMES,
  LOCATIONS,
  MAPPING_EXCEPTIONS,
  MENU,
  ORG_ID,
  RESTAURANT_ID,
  STOCK_SCENARIOS,
  TODAY_CANCEL_OVERRIDE,
  USERS,
  WEEKDAY_FACTOR,
} from "./catalog";

const HISTORY_DAYS = 30;
const ACTIVE_WINDOW_MIN = 40;
const RIDER_NAMES = ["Imran", "Bilal", "Rakesh", "Sameer", "Joseph", "Anwar", "Faisal", "Kiran", "Noel", "Asif", "Tariq", "Vijay"];
const CANCEL_REASONS = ["Customer cancelled", "Item unavailable", "Rider not assigned", "Restaurant busy", "Duplicate order"];

export function defaultSettings(): WorkspaceSettings {
  return {
    sla: { ...DEFAULT_SLA },
    economics: Object.fromEntries(
      ORDER_CHANNELS.map((c) => [c, { ...CHANNEL_CATALOG[c].defaultEconomics }]),
    ) as WorkspaceSettings["economics"],
    demo: { enabled: true, orderIntervalSeconds: 45, autoProgress: true, channelIncidents: true },
    aiProvider: "deterministic",
  };
}

export function generateDemoDatabase(now: number = Date.now()): Database {
  const rng = createRng(20_260_927);
  const createdAt = iso(now - (HISTORY_DAYS + 60) * DAY);

  const db: Database = {
    organization: {
      id: ORG_ID,
      name: "CornerOps Demo",
      slug: "cornerops-demo",
      currency: "AED",
      timezone: "Asia/Dubai",
      isDemo: true,
      createdAt,
      updatedAt: createdAt,
    },
    restaurant: {
      id: RESTAURANT_ID,
      organizationId: ORG_ID,
      name: "Casa Norte Mexican Kitchen",
      cuisine: "Mexican",
      createdAt,
      updatedAt: createdAt,
    },
    locations: [],
    users: [],
    customers: [],
    orders: [],
    ordersById: new Map(),
    menuCategories: [],
    menuItems: [],
    menuMappings: [],
    inventoryItems: [],
    inventoryMovements: [],
    channelConnections: [],
    channelLogs: [],
    inboxes: Object.fromEntries(ORDER_CHANNELS.map((c) => [c, []])) as unknown as Database["inboxes"],
    acknowledgedAlerts: new Set(),
    alertFirstSeen: new Map(),
    settings: defaultSettings(),
    counters: { id: 1000, orderNumber: 16_400, externalSequence: 0 },
    simulation: {
      lastTickAt: now,
      nextOrderAt: now + 25_000,
      nextIncidentAt: now + 4 * MINUTE,
      recoveries: [],
      events: [],
    },
    seededAt: now,
  };

  seedLocationsAndUsers(db, createdAt);
  seedCustomers(db, rng, now);
  seedMenu(db, createdAt);
  seedConnections(db, rng, now, createdAt);
  seedInventory(db, rng, now, createdAt);
  seedOrders(db, rng, now);
  seedMovements(db, rng, now);
  seedChannelLogs(db, rng, now);
  return db;
}

// ---------------------------------------------------------------------------

function seedLocationsAndUsers(db: Database, createdAt: string) {
  db.locations = LOCATIONS.map<Location>((l) => ({
    id: l.id,
    organizationId: ORG_ID,
    restaurantId: RESTAURANT_ID,
    name: l.name,
    code: l.code,
    area: l.area,
    address: l.address,
    operatingHours: { open: l.open, close: l.close },
    kitchenCapacity: l.kitchenCapacity,
    managerName: l.managerName,
    isOpen: true,
    createdAt,
    updatedAt: createdAt,
  }));
  db.users = USERS.map<AppUser>((u) => ({ ...u, organizationId: ORG_ID, createdAt, updatedAt: createdAt }));
}

function seedCustomers(db: Database, rng: Rng, now: number) {
  const used = new Set<string>();
  for (let i = 0; i < 160; i++) {
    let name = "";
    do name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    while (used.has(name));
    used.add(name);
    const prefix = rng.pick(["50", "52", "54", "55", "56", "58"]);
    const num = rng.int(1_000_000, 9_999_999).toString();
    const first = iso(now - rng.int(20, 400) * DAY);
    db.customers.push({
      id: `cus_${(i + 1).toString().padStart(4, "0")}`,
      organizationId: ORG_ID,
      name,
      phone: `+971 ${prefix} ${num.slice(0, 3)} ${num.slice(3)}`,
      area: rng.pick(CUSTOMER_AREAS),
      firstOrderAt: first,
      createdAt: first,
      updatedAt: first,
    } satisfies Customer);
  }
}

function seedMenu(db: Database, createdAt: string) {
  const costByKey = new Map(INGREDIENTS.map((i) => [i.key, i.unitCost]));
  db.menuCategories = CATEGORIES.map((c, i) => ({
    id: c.id,
    organizationId: ORG_ID,
    name: c.name,
    sortOrder: i,
    createdAt,
    updatedAt: createdAt,
  }));
  db.menuItems = MENU.map<MenuItem>((m) => ({
    id: `itm_${m.sku.toLowerCase().replace(/-/g, "_")}`,
    organizationId: ORG_ID,
    categoryId: m.categoryId,
    name: m.name,
    description: m.description,
    sku: m.sku,
    price: m.price,
    foodCost: round2(m.recipe.reduce((s, [key, qty]) => s + (costByKey.get(key) ?? 0) * qty, 0)),
    isAvailable: true,
    prepTimeMinutes: m.prep,
    taxRate: 0.05,
    imageEmoji: m.emoji,
    popularity: m.popularity,
    tags: m.tags,
    recipe: m.recipe.map(([inventoryItemKey, quantity]) => ({ inventoryItemKey, quantity })),
    createdAt,
    updatedAt: createdAt,
  }));
  for (const [index, item] of db.menuItems.entries()) {
    for (const channel of ORDER_CHANNELS) {
      const ex = MAPPING_EXCEPTIONS.find((e) => e.sku === item.sku && e.channel === channel);
      const missing = ex?.status === "missing";
      const outOfSync = ex?.status === "out_of_sync";
      db.menuMappings.push({
        id: `map_${item.sku.toLowerCase().replace(/-/g, "_")}_${channel}`,
        organizationId: ORG_ID,
        menuItemId: item.id,
        channel,
        externalItemId: missing ? null : EXTERNAL_ITEM_ID[channel](item.sku, index),
        externalName: missing ? null : item.name,
        channelPrice: missing ? null : outOfSync ? item.price - 2 : item.price,
        status: ex?.status ?? "synced",
        lastSyncedAt: missing ? null : createdAt,
        message: ex?.message,
        createdAt,
        updatedAt: createdAt,
      } satisfies MenuChannelMapping);
    }
  }
}

function seedConnections(db: Database, rng: Rng, now: number, createdAt: string) {
  const baseLatency: Record<OrderChannel, number> = {
    talabat: 180,
    deliveroo: 240,
    noon: 310,
    keeta: 420,
    direct: 60,
    whatsapp: 90,
  };
  for (const l of LOCATIONS) {
    for (const channel of ORDER_CHANNELS) {
      const externalStoreId = l.externalStoreIds[channel];
      if (!externalStoreId) continue;
      const degraded = channel === "keeta" && l.id === "loc_jvc";
      db.channelConnections.push({
        id: `conn_${channel}_${l.id.replace("loc_", "")}`,
        organizationId: ORG_ID,
        locationId: l.id,
        channel,
        externalStoreId,
        status: degraded ? "degraded" : "connected",
        mode: "mock",
        latencyMs: degraded ? 4200 : Math.round(baseLatency[channel] * rng.float(0.8, 1.25)),
        lastSyncAt: iso(now - (degraded ? 4.5 * MINUTE : rng.int(4, 40) * 1000)),
        errorCount: degraded ? 3 : 0,
        message: degraded ? "Order webhooks arriving ~4 min late" : undefined,
        createdAt,
        updatedAt: createdAt,
      } satisfies ChannelConnection);
    }
  }
}

function seedInventory(db: Database, rng: Rng, now: number, createdAt: string) {
  for (const l of LOCATIONS) {
    const scenario = STOCK_SCENARIOS[l.id] ?? {};
    const scale = l.dailyOrders / 55;
    for (const ing of INGREDIENTS) {
      const par = round2(ing.par * scale);
      const threshold = round2(par * 0.35);
      const factor = scenario[ing.key];
      const quantity =
        factor !== undefined ? round2(threshold * factor) : round2(par * rng.float(0.55, 1.05));
      db.inventoryItems.push({
        id: `inv_${l.id.replace("loc_", "")}_${ing.key}`,
        key: ing.key,
        organizationId: ORG_ID,
        locationId: l.id,
        name: ing.name,
        category: ing.category,
        unit: ing.unit,
        quantity: ing.unit === "pcs" || ing.unit === "bunch" ? Math.round(quantity) : quantity,
        threshold: ing.unit === "pcs" || ing.unit === "bunch" ? Math.round(threshold) : threshold,
        parLevel: ing.unit === "pcs" || ing.unit === "bunch" ? Math.round(par) : par,
        unitCost: ing.unitCost,
        supplier: ing.supplier,
        createdAt,
        updatedAt: iso(now - rng.int(5, 90) * MINUTE),
      } satisfies InventoryItem);
    }
  }
}

// ---------------------------------------------------------------------------
// Orders

interface PlannedOrder {
  at: number;
  locationId: string;
  channel: OrderChannel;
  day: number; // days ago (0 = today)
  active?: ActiveTemplate;
}

interface ActiveTemplate {
  ageMin: number;
  status: OrderStatus;
  prepFactor: number;
  forceChannel?: OrderChannel;
}

const ACTIVE_WAVE: Record<string, ActiveTemplate[]> = {
  loc_marina: [
    { ageMin: 1.1, status: "new", prepFactor: 1 },
    { ageMin: 2.6, status: "new", prepFactor: 1.1, forceChannel: "deliveroo" },
    { ageMin: 5.2, status: "accepted", prepFactor: 1 },
    { ageMin: 8.5, status: "preparing", prepFactor: 0.95 },
    { ageMin: 12.4, status: "preparing", prepFactor: 1.2 },
    { ageMin: 16.8, status: "preparing", prepFactor: 1.3 },
    { ageMin: 26.5, status: "preparing", prepFactor: 3.6, forceChannel: "talabat" },
    { ageMin: 28.9, status: "preparing", prepFactor: 3.4 },
    { ageMin: 31.2, status: "preparing", prepFactor: 3.8, forceChannel: "deliveroo" },
    { ageMin: 33.6, status: "preparing", prepFactor: 3.5 },
    { ageMin: 36.0, status: "ready", prepFactor: 1.4, forceChannel: "talabat" },
  ],
  loc_bbay: [
    { ageMin: 0.7, status: "new", prepFactor: 1, forceChannel: "talabat" },
    { ageMin: 4.1, status: "accepted", prepFactor: 1 },
    { ageMin: 9.3, status: "preparing", prepFactor: 1 },
    { ageMin: 13.7, status: "preparing", prepFactor: 1.1 },
    { ageMin: 19.4, status: "ready", prepFactor: 1 },
    { ageMin: 24.0, status: "picked_up", prepFactor: 1 },
  ],
  loc_jvc: [
    { ageMin: 1.8, status: "new", prepFactor: 1, forceChannel: "keeta" },
    { ageMin: 6.3, status: "preparing", prepFactor: 1.2 },
    { ageMin: 11.1, status: "preparing", prepFactor: 1.4 },
    { ageMin: 17.5, status: "preparing", prepFactor: 1.6 },
    { ageMin: 22.2, status: "ready", prepFactor: 1 },
    { ageMin: 30.5, status: "picked_up", prepFactor: 1 },
  ],
};

function hourlyTimestamps(
  rng: Rng,
  dayStart: number,
  count: number,
  location: (typeof LOCATIONS)[number],
  cutoff: number,
): number[] {
  const closesAtMidnight = location.close === "00:00";
  const hours = Object.keys(HOURLY_WEIGHTS)
    .map(Number)
    .filter((h) => !(closesAtMidnight && h === 0));
  const weights = hours.map((h) => HOURLY_WEIGHTS[h]);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const h = rng.weighted(hours, weights);
    const ts = dayStart + h * HOUR + rng.int(0, 3599) * 1000;
    if (ts <= cutoff) out.push(ts);
  }
  return out;
}

function seedOrders(db: Database, rng: Rng, now: number) {
  const todayStart = startOfDubaiDay(now);
  const plan: PlannedOrder[] = [];
  const cutoff = now - ACTIVE_WINDOW_MIN * MINUTE;

  for (const loc of LOCATIONS) {
    let yesterdayVolume = 0;
    for (let d = HISTORY_DAYS; d >= 0; d--) {
      const dayStart = todayStart - d * DAY;
      const weekday = new Date(dayStart + 16 * HOUR).getUTCDay();
      const growth = 1 - d * 0.0035;
      let volume = loc.dailyOrders * WEEKDAY_FACTOR[weekday] * growth * rng.normal(1, 0.05);
      if (d === 1) yesterdayVolume = volume;
      if (d === 0) volume = yesterdayVolume * 1.12;
      const count = Math.round(volume);
      for (const at of hourlyTimestamps(rng, dayStart, count, loc, d === 0 ? cutoff : Infinity)) {
        const channel = pickChannel(db, rng, loc.id);
        if (channel) plan.push({ at, locationId: loc.id, channel, day: d });
      }
    }
    for (const t of ACTIVE_WAVE[loc.id] ?? []) {
      const channel = t.forceChannel ?? pickChannel(db, rng, loc.id);
      if (channel) plan.push({ at: now - t.ageMin * MINUTE, locationId: loc.id, channel, day: 0, active: t });
    }
  }

  plan.sort((a, b) => a.at - b.at);

  const backend = createMockBackend(db, () => now, rng.next);
  const adapters = createMockAdapters(backend);

  for (const p of plan) {
    const spec = buildOrderSpec(db, rng, { locationId: p.locationId, channel: p.channel, placedAt: p.at });
    if (!spec) continue;
    const payload = adapters[p.channel].fabricate(spec);
    const ctx = createNormalizationContext(db, p.at);
    const order = finalizeIngestedOrder(db, adapters[p.channel].normalizeOrder(payload, ctx));
    order.source = "seed";
    const loc = LOCATIONS.find((l) => l.id === p.locationId)!;
    if (p.active) applyActiveLifecycle(order, rng, now, p.active);
    else applyHistoricalLifecycle(order, rng, now, loc, p.day);
    insertOrder(db, order);
  }
}

function riderName(rng: Rng) {
  return rng.pick(RIDER_NAMES);
}

function applyHistoricalLifecycle(
  order: UnifiedOrder,
  rng: Rng,
  now: number,
  loc: (typeof LOCATIONS)[number],
  daysAgo: number,
) {
  const placed = toMs(order.placedAt)!;
  const behaviour = CHANNEL_BEHAVIOUR[order.channel];
  const cancelRate = daysAgo === 0 ? (TODAY_CANCEL_OVERRIDE[order.channel] ?? behaviour.cancelRate) : behaviour.cancelRate;
  const stamp = (ts: number) => iso(Math.min(ts, now));

  if (rng.chance(cancelRate)) {
    const afterAccept = rng.chance(0.35);
    const cancelledAt = placed + rng.float(1, 7) * MINUTE;
    if (afterAccept) order.acceptedAt = stamp(placed + rng.float(0.5, 2) * MINUTE);
    order.status = "cancelled";
    order.cancelledAt = stamp(cancelledAt);
    order.cancellationReason =
      order.channel === "deliveroo" && daysAgo === 0 && rng.chance(0.6) ? "Rider not assigned" : rng.pick(CANCEL_REASONS);
    order.updatedAt = order.cancelledAt;
    if (order.courier) order.courier = { ...order.courier, status: "unassigned" };
    return;
  }

  const hour = dubaiHour(placed);
  const peak = (hour >= 12 && hour <= 14) || (hour >= 19 && hour <= 21) ? 1.12 : 0.95;
  const factor = daysAgo === 0 ? loc.todayPrepFactor : 1;
  const prep = Math.min(42, Math.max(7, rng.normal(loc.basePrepMinutes * factor * peak, 2.6)));
  const accepted = placed + rng.float(0.4, 2.6) * MINUTE;
  const started = accepted + rng.float(0, 1.2) * MINUTE;
  const ready = accepted + prep * MINUTE;
  const pickedUp = ready + rng.float(2, 9) * MINUTE;
  const completed = order.fulfillment === "delivery" ? pickedUp + rng.float(13, 30) * MINUTE : pickedUp;

  const steps: [OrderStatus, number][] = [
    ["accepted", accepted],
    ["preparing", started],
    ["ready", ready],
    ["picked_up", pickedUp],
    ["completed", completed],
  ];
  order.status = "new";
  for (const [status, ts] of steps) {
    if (ts > now) break;
    order.status = status;
  }
  if (accepted <= now) order.acceptedAt = iso(accepted);
  if (started <= now) order.preparationStartedAt = iso(started);
  if (ready <= now) order.readyAt = iso(ready);
  if (pickedUp <= now) order.pickedUpAt = iso(pickedUp);
  if (completed <= now) order.completedAt = iso(completed);
  order.updatedAt = iso(Math.min(now, completed));
  if (order.courier) {
    order.courier = {
      ...order.courier,
      name: riderName(rng),
      status: order.status === "completed" ? "delivered" : order.status === "picked_up" ? "picked_up" : "assigned",
    };
  }
}

function applyActiveLifecycle(order: UnifiedOrder, rng: Rng, now: number, t: ActiveTemplate) {
  const placed = toMs(order.placedAt)!;
  const accepted = placed + Math.min(t.ageMin * 0.4, rng.float(0.6, 1.6)) * MINUTE;
  order.metadata = { ...order.metadata, sim: { prepFactor: t.prepFactor } };
  order.status = t.status;
  if (t.status === "new") return;

  order.acceptedAt = iso(accepted);
  if (order.courier) order.courier = { ...order.courier, name: riderName(rng), status: "assigned" };
  if (t.status === "accepted") {
    order.updatedAt = order.acceptedAt;
    return;
  }
  order.preparationStartedAt = iso(accepted + 0.4 * MINUTE);
  order.updatedAt = order.preparationStartedAt;
  if (t.status === "preparing") return;

  const age = now - accepted;
  const ready = accepted + Math.min(age - 2 * MINUTE, order.estimatedPrepMinutes * t.prepFactor * MINUTE);
  order.readyAt = iso(ready);
  order.updatedAt = order.readyAt;
  if (order.courier) order.courier = { ...order.courier, status: "arriving", etaMinutes: rng.int(2, 7) };
  if (t.status === "ready") return;

  order.pickedUpAt = iso(ready + Math.min((now - ready) * 0.5, 5 * MINUTE));
  order.updatedAt = order.pickedUpAt;
  if (order.courier) order.courier = { ...order.courier, status: "picked_up", etaMinutes: rng.int(9, 22) };
}

// ---------------------------------------------------------------------------
// Inventory movements & logs

function seedMovements(db: Database, rng: Rng, now: number) {
  const menuById = new Map(db.menuItems.map((m) => [m.id, m]));
  const todayStart = startOfDubaiDay(now);
  const byLocKey = new Map(db.inventoryItems.map((i) => [`${i.locationId}:${i.key}`, i]));
  const movements: InventoryMovement[] = [];
  const push = (m: Omit<InventoryMovement, "id" | "organizationId" | "updatedAt">) =>
    movements.push({ ...m, id: newId(db, "mov"), organizationId: ORG_ID, updatedAt: m.createdAt });

  for (let d = 6; d >= 0; d--) {
    const dayStart = todayStart - d * DAY;
    const dayEnd = Math.min(dayStart + DAY, now);
    // Aggregated usage per ingredient (synced from the order stream at close).
    const usage = new Map<string, number>();
    for (const o of db.orders) {
      const ts = toMs(o.acceptedAt);
      if (!ts || ts < dayStart || ts >= dayEnd || o.status === "cancelled") continue;
      for (const [key, qty] of recipeUsage(o, menuById)) {
        const k = `${o.locationId}:${key}`;
        usage.set(k, (usage.get(k) ?? 0) + qty);
      }
    }
    for (const [k, qty] of usage) {
      const item = byLocKey.get(k);
      if (!item) continue;
      push({
        locationId: item.locationId,
        inventoryItemId: item.id,
        type: "usage",
        quantity: -round2(qty),
        note: d === 0 ? "Usage so far today (order stream)" : "Daily usage (order stream)",
        actorLabel: "system",
        createdAt: iso(Math.min(dayEnd - 1, dayStart + 23.9 * HOUR)),
      });
    }
    // Deliveries every other morning.
    for (const item of db.inventoryItems) {
      if ((d + item.key.length) % 2 === 0 && dayStart + 8 * HOUR < now) {
        push({
          locationId: item.locationId,
          inventoryItemId: item.id,
          type: "purchase",
          quantity: round2(item.parLevel * rng.float(0.35, 0.6)),
          note: `Delivery · ${item.supplier}`,
          actorLabel: "usr_gm",
          createdAt: iso(dayStart + 8 * HOUR + rng.int(0, 90) * MINUTE),
        });
      }
      if (["Produce", "Seafood", "Prepared"].includes(item.category) && rng.chance(0.12) && dayStart + 23 * HOUR < now) {
        push({
          locationId: item.locationId,
          inventoryItemId: item.id,
          type: "waste",
          quantity: -round2(item.parLevel * rng.float(0.01, 0.04)),
          note: rng.pick(["Spoilage at close", "Quality check — discarded", "Dropped during prep"]),
          actorLabel: "usr_kitchen",
          createdAt: iso(dayStart + 23 * HOUR),
        });
      }
    }
  }
  // Stock counts and inter-branch transfers.
  const find = (loc: string, key: string) => byLocKey.get(`${loc}:${key}`)!;
  const t = (h: number) => iso(now - h * HOUR);
  push({ locationId: "loc_marina", inventoryItemId: find("loc_marina", "avocados").id, type: "adjustment", quantity: -12, note: "Stock count variance", actorLabel: "usr_marina", createdAt: t(26) });
  push({ locationId: "loc_bbay", inventoryItemId: find("loc_bbay", "consome").id, type: "transfer", quantity: -6, note: "Transfer to Dubai Marina", actorLabel: "usr_gm", createdAt: t(20) });
  push({ locationId: "loc_marina", inventoryItemId: find("loc_marina", "consome").id, type: "transfer", quantity: 6, note: "Transfer from Business Bay", actorLabel: "usr_gm", createdAt: t(20) });
  push({ locationId: "loc_jvc", inventoryItemId: find("loc_jvc", "hibiscus").id, type: "waste", quantity: -3.2, note: "Batch failed quality check", actorLabel: "usr_jvc", createdAt: t(5) });
  push({ locationId: "loc_jvc", inventoryItemId: find("loc_jvc", "hibiscus").id, type: "adjustment", quantity: -1.1, note: "Stock count — container empty", actorLabel: "usr_jvc", createdAt: t(2) });

  movements.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  db.inventoryMovements = movements;
}

function seedChannelLogs(db: Database, rng: Rng, now: number) {
  const entries: { channel: OrderChannel; level: "info" | "warning" | "error"; message: string; minsAgo: number; loc?: string }[] = [
    { channel: "keeta", level: "warning", message: "Order webhook delivered 262s after placement", minsAgo: 4, loc: "loc_jvc" },
    { channel: "keeta", level: "error", message: "Webhook timeout (5000ms) — retry scheduled", minsAgo: 9, loc: "loc_jvc" },
    { channel: "keeta", level: "warning", message: "Latency above 4s threshold", minsAgo: 14, loc: "loc_jvc" },
    { channel: "noon", level: "info", message: "Menu sync completed: 23 items, 4 not listed", minsAgo: 95 },
    { channel: "deliveroo", level: "warning", message: "Price mismatch detected for Carne Asada Burrito", minsAgo: 180 },
    { channel: "talabat", level: "error", message: "Menu image rejected for Queso Fundido (min 800px)", minsAgo: 240 },
    { channel: "talabat", level: "info", message: "Menu sync completed: 26 items", minsAgo: 241 },
    { channel: "direct", level: "info", message: "Storefront menu published", minsAgo: 300 },
    { channel: "whatsapp", level: "info", message: "Catalog sync completed (26 products)", minsAgo: 320 },
  ];
  for (const e of entries) {
    db.channelLogs.push({
      id: newId(db, "log"),
      channel: e.channel,
      level: e.level,
      message: e.message,
      locationId: e.loc,
      at: iso(now - e.minsAgo * MINUTE - rng.int(0, 50) * 1000),
    });
  }
  db.channelLogs.sort((a, b) => a.at.localeCompare(b.at));
}
