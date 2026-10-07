import { MARKETPLACE_CHANNELS, ORDER_CHANNELS, channelName } from "@/domain/channels/types";
import type { OrderAction } from "@/domain/orders/state-machine";
import type { OrderChannel } from "@/domain/channels/types";
import type { UnifiedOrder } from "@/domain/orders/types";
import { ACTIVE_STATUSES } from "@/domain/orders/types";
import { MINUTE, iso, toMs } from "@/lib/time";
import { createNormalizationContext, newId } from "../store/backend";
import { finalizeIngestedOrder, insertOrder } from "../store/order-helpers";
import type { Runtime } from "../store/runtime";
import type { SimulationEvent } from "../store/types";
import { transitionOrder } from "../services/order-transitions";
import { buildOrderSpec, pickChannel, pickLocation } from "./traffic";

const MAX_EVENTS = 200;
const MAX_SPAWN_PER_TICK = 3;

function pushEvent(rt: Runtime, kind: SimulationEvent["kind"], message: string, at: number) {
  const events = rt.db.simulation.events;
  events.push({ id: newId(rt.db, "evt"), kind, message, at: iso(at) });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Deterministic 0..1 value per order, so simulated timings are stable across ticks. */
function orderHash(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Simulate a customer placing an order on a (mock) platform. The order lands in the platform inbox. */
export function emitSimulatedOrder(
  rt: Runtime,
  now: number,
  opts: { channel?: OrderChannel; locationId?: string } = {},
): { channel: OrderChannel; locationId: string } | null {
  const { db, rng } = rt;
  const locationId = opts.locationId ?? pickLocation(db, rng);
  const channel = opts.channel ?? pickChannel(db, rng, locationId);
  if (!channel) return null;
  if (!db.channelConnections.some((c) => c.channel === channel && c.locationId === locationId)) return null;
  const spec = buildOrderSpec(db, rng, { locationId, channel, placedAt: now });
  rt.adapters[channel].emitOrder(spec);
  return { channel, locationId };
}

/** Poll every channel adapter and ingest the normalized orders. Returns newly created orders. */
export async function ingest(rt: Runtime, now: number): Promise<UnifiedOrder[]> {
  const ctx = createNormalizationContext(rt.db, now);
  const created: UnifiedOrder[] = [];
  for (const channel of ORDER_CHANNELS) {
    if (!rt.db.inboxes[channel].length) continue;
    const orders = await rt.adapters[channel].getOrders(ctx);
    for (const order of orders) {
      if (rt.db.orders.some((o) => o.channel === order.channel && o.externalOrderId === order.externalOrderId)) continue;
      finalizeIngestedOrder(rt.db, order);
      insertOrder(rt.db, order);
      created.push(order);
      const loc = rt.db.locations.find((l) => l.id === order.locationId);
      pushEvent(rt, "order_received", `${channelName(order.channel)} order ${order.orderNumber} · ${loc?.name ?? ""}`, now);
    }
  }
  return created;
}

function nextAutoAction(order: UnifiedOrder, now: number, rt: Runtime): OrderAction | null {
  const manual = order.metadata?.manual === true || order.metadata?.demoHold === true;
  const h = orderHash(order.id, 7);
  const since = (ts?: string) => now - (toMs(ts) ?? now);

  if (order.status === "picked_up") {
    const deliverMs = order.fulfillment === "delivery" ? (12 + h * 14) * MINUTE : 0;
    return since(order.pickedUpAt) >= deliverMs ? "complete" : null;
  }
  if (manual || !rt.db.settings.demo.autoProgress) return null;

  switch (order.status) {
    case "new":
      return since(order.placedAt) >= (1.6 + h * 1.8) * MINUTE ? "accept" : null;
    case "accepted":
      return since(order.acceptedAt) >= (0.6 + h * 0.8) * MINUTE ? "start_preparing" : null;
    case "preparing": {
      const sim = order.metadata?.sim as { prepFactor?: number } | undefined;
      const factor = sim?.prepFactor ?? 0.8 + h * 0.55;
      return since(order.acceptedAt) >= order.estimatedPrepMinutes * factor * MINUTE ? "mark_ready" : null;
    }
    case "ready":
      if (order.fulfillment === "pickup") return since(order.readyAt) >= (2 + h * 6) * MINUTE ? "complete" : null;
      return since(order.readyAt) >= (2.5 + h * 6) * MINUTE ? "mark_picked_up" : null;
    default:
      return null;
  }
}

async function progressOrders(rt: Runtime, now: number) {
  const candidates = rt.db.orders.filter(
    (o) => (ACTIVE_STATUSES.includes(o.status) || o.status === "picked_up") && now - (toMs(o.placedAt) ?? now) < 6 * 60 * MINUTE,
  );
  for (const order of candidates) {
    const action = nextAutoAction(order, now, rt);
    if (!action) continue;
    const res = await transitionOrder(rt, order, action, { type: "simulator" }, { at: now });
    if (action === "mark_ready" || action === "accept") {
      pushEvent(rt, "status_change", `${res.order.orderNumber} → ${res.order.status.replace("_", " ")}`, now);
    }
  }
}

function channelIncidents(rt: Runtime, now: number) {
  const { db, rng } = rt;
  const sim = db.simulation;
  for (const r of sim.recoveries.filter((r) => r.at <= now)) {
    const conn = db.channelConnections.find((c) => c.id === r.connectionId);
    if (conn && conn.status === "degraded") {
      conn.status = "connected";
      conn.message = undefined;
      conn.latencyMs = Math.round(conn.latencyMs / 12) + 150;
      conn.lastSyncAt = iso(now);
      conn.updatedAt = iso(now);
      db.channelLogs.push({ id: newId(db, "log"), channel: conn.channel, level: "info", message: "Latency back to normal (simulated recovery)", locationId: conn.locationId, at: iso(now) });
      pushEvent(rt, "channel_recovered", `${channelName(conn.channel)} recovered`, now);
    }
  }
  sim.recoveries = sim.recoveries.filter((r) => r.at > now);

  if (!db.settings.demo.channelIncidents || now < sim.nextIncidentAt) return;
  sim.nextIncidentAt = now + (5 + rng.next() * 5) * MINUTE;
  const pool = db.channelConnections.filter(
    (c) => c.status === "connected" && (MARKETPLACE_CHANNELS as readonly string[]).includes(c.channel),
  );
  if (!pool.length) return;
  const conn = rng.pick(pool);
  conn.status = "degraded";
  conn.latencyMs = rng.int(2600, 5200);
  conn.message = "Elevated API latency (simulated incident)";
  conn.updatedAt = iso(now);
  db.channelLogs.push({ id: newId(db, "log"), channel: conn.channel, level: "warning", message: `API latency ${conn.latencyMs}ms — above 2s threshold (simulated)`, locationId: conn.locationId, at: iso(now) });
  sim.recoveries.push({ connectionId: conn.id, at: now + (1.5 + rng.next() * 2) * MINUTE });
  pushEvent(rt, "channel_incident", `${channelName(conn.channel)} degraded at ${db.locations.find((l) => l.id === conn.locationId)?.name}`, now);
}

async function runTick(rt: Runtime, now: number) {
  const { db, rng } = rt;
  const demo = db.settings.demo;
  const sim = db.simulation;

  if (demo.enabled) {
    if (now - sim.nextOrderAt > MAX_SPAWN_PER_TICK * demo.orderIntervalSeconds * 1000) {
      sim.nextOrderAt = now; // came back from idle: don't flood the queue
    }
    let spawned = 0;
    while (sim.nextOrderAt <= now && spawned < MAX_SPAWN_PER_TICK) {
      emitSimulatedOrder(rt, Math.min(now, sim.nextOrderAt));
      spawned += 1;
      sim.nextOrderAt += demo.orderIntervalSeconds * 1000 * (0.5 + rng.next());
    }
    channelIncidents(rt, now);
  }

  await ingest(rt, now);
  if (demo.enabled) await progressOrders(rt, now);
  sim.lastTickAt = now;
}

/** Advance the demo world to `now`. Safe to call on every read; ticks are serialized. */
export async function tick(rt: Runtime, now = Date.now()): Promise<void> {
  if (rt.ticking) return rt.ticking;
  if (now - rt.db.simulation.lastTickAt < 750) return;
  rt.ticking = runTick(rt, now).finally(() => {
    rt.ticking = null;
  });
  return rt.ticking;
}
