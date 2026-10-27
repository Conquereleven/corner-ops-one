import { MARKETPLACE_CHANNELS, channelName, type OrderChannel } from "@/domain/channels/types";
import { blockedByShortfall, type OrderAction } from "@/domain/orders/state-machine";
import type { UnifiedOrder } from "@/domain/orders/types";
import { createRng, type Rng } from "@/lib/rng";
import { MINUTE, iso, toMs } from "@/lib/time";
import { appMode } from "../config";
import type { Db } from "../db/client";
import { withSystemTransaction, type Actor } from "../db/transaction";
import { createRepositories, type Repositories } from "../repositories";
import { buildOrderSpec, pickChannel, pickLocation } from "../simulation/traffic";
import type { Database, SimulationEvent, WorkspaceSettings } from "../store/types";
import { ingestPendingOrders, type IngestionContext } from "../services/ingestion";
import { transitionOrder } from "../services/order-transitions";
import { loadChannelRuntime, type ChannelRuntime } from "./backend-session";

const SIMULATOR: Actor = { kind: "system", label: "simulator" };
const MAX_SPAWN_PER_TICK = 3;
const MAX_FEED = 60;
const MIN_TICK_MS = 1500;

interface DemoState {
  lastTickAt: number;
  nextOrderAt: number;
  nextIncidentAt: number;
  recoveries: { connectionId: string; at: number }[];
  events: SimulationEvent[];
  inboxes: Record<string, unknown[]>;
  externalSequence: number;
}

async function loadState(db: Db, orgId: string): Promise<DemoState | null> {
  const [r] = await db`select * from public.demo_workspace_state where organization_id = ${orgId} for update`;
  if (!r) return null;
  return {
    lastTickAt: Date.parse(String(r.last_tick_at)),
    nextOrderAt: Date.parse(String(r.next_order_at)),
    nextIncidentAt: Date.parse(String(r.next_incident_at)),
    recoveries: (r.recoveries as DemoState["recoveries"]) ?? [],
    events: (r.events as SimulationEvent[]) ?? [],
    inboxes: (r.inboxes as Record<string, unknown[]>) ?? {},
    externalSequence: Number(r.external_sequence),
  };
}

async function saveState(db: Db, orgId: string, s: DemoState) {
  await db`
    update public.demo_workspace_state set
      last_tick_at = ${iso(s.lastTickAt)}, next_order_at = ${iso(s.nextOrderAt)}, next_incident_at = ${iso(s.nextIncidentAt)},
      recoveries = ${db.json(s.recoveries as never)}, events = ${db.json(s.events.slice(-MAX_FEED) as never)},
      inboxes = ${db.json(s.inboxes as never)}, external_sequence = ${s.externalSequence}, updated_at = now()
    where organization_id = ${orgId}`;
}

/** Deterministic 0..1 per order, so simulated timings are stable across ticks. */
function orderHash(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export function nextAutoAction(order: UnifiedOrder, now: number, autoProgress: boolean): OrderAction | null {
  const manual = order.metadata?.manual === true || order.metadata?.demoHold === true;
  const h = orderHash(order.id, 7);
  const since = (ts?: string) => now - (toMs(ts) ?? now);
  if (order.status === "picked_up") {
    const deliverMs = order.fulfillment === "delivery" ? (12 + h * 14) * MINUTE : 0;
    return since(order.pickedUpAt) >= deliverMs ? "complete" : null;
  }
  if (manual || !autoProgress) return null;
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

interface World {
  ic: IngestionContext;
  /** Shape expected by the (pure) traffic generator. */
  db: Database;
  settings: WorkspaceSettings;
}

async function loadWorld(repos: Repositories, runtime: ChannelRuntime, state: DemoState): Promise<World> {
  const [org, restaurant, locations, menu, mappings, customers, settings] = await Promise.all([
    repos.organization.get(),
    repos.organization.restaurant(),
    repos.locations.list(),
    repos.menu.items(),
    repos.menu.mappings(),
    repos.customers.list(),
    repos.organization.settings(),
  ]);
  const inventoryItems = await repos.inventory.items(locations.map((l) => l.id));
  const ic: IngestionContext = {
    organizationId: org.id,
    restaurantId: restaurant.id,
    connections: runtime.backend.connections,
    mappings,
    menuItems: menu,
    customers,
    economics: settings.economics,
  };
  const db = {
    organization: org,
    restaurant,
    locations,
    channelConnections: runtime.backend.connections,
    menuMappings: mappings,
    menuItems: menu,
    inventoryItems,
    customers,
    settings,
    counters: { id: 0, orderNumber: 0, externalSequence: state.externalSequence },
  } as unknown as Database;
  return { ic, db, settings };
}

function feed(state: DemoState, kind: SimulationEvent["kind"], message: string, at: number) {
  state.events.push({ id: `evt_${at}_${state.events.length}`, kind, message, at: iso(at) });
  if (state.events.length > MAX_FEED) state.events.splice(0, state.events.length - MAX_FEED);
}

function emit(world: World, runtime: ChannelRuntime, rng: Rng, now: number, opts: { channel?: OrderChannel; locationId?: string } = {}) {
  const locationId = opts.locationId ?? pickLocation(world.db, rng);
  const channel = opts.channel ?? pickChannel(world.db, rng, locationId);
  if (!channel) return null;
  if (!runtime.backend.connections.some((c) => c.channel === channel && c.locationId === locationId)) return null;
  const spec = buildOrderSpec(world.db, rng, { locationId, channel, placedAt: now });
  if (!spec) return null; // nothing sellable at this location right now
  runtime.adapters[channel].emitOrder(spec);
  return { channel, locationId };
}

async function incidents(repos: Repositories, runtime: ChannelRuntime, world: World, state: DemoState, rng: Rng, now: number) {
  const { backend } = runtime;
  for (const r of state.recoveries.filter((r) => r.at <= now)) {
    const conn = backend.connections.find((c) => c.id === r.connectionId);
    if (conn && conn.status === "degraded") {
      backend.setConnectionStatus(conn.channel, "connected", { locationId: conn.locationId, latencyMs: Math.round(conn.latencyMs / 12) + 150 });
      backend.log(conn.channel, "info", "Latency back to normal (simulated recovery)", conn.locationId);
      feed(state, "channel_recovered", `${channelName(conn.channel)} recovered`, now);
    }
  }
  state.recoveries = state.recoveries.filter((r) => r.at > now);

  if (!world.settings.demo.channelIncidents || now < state.nextIncidentAt) return;
  state.nextIncidentAt = now + (5 + rng.next() * 5) * MINUTE;
  const pool = backend.connections.filter((c) => c.status === "connected" && (MARKETPLACE_CHANNELS as readonly string[]).includes(c.channel));
  if (!pool.length) return;
  const conn = rng.pick(pool);
  const latency = rng.int(2600, 5200);
  backend.setConnectionStatus(conn.channel, "degraded", { locationId: conn.locationId, latencyMs: latency, message: "Elevated API latency (simulated incident)" });
  backend.log(conn.channel, "warning", `API latency ${latency}ms — above 2s threshold (simulated)`, conn.locationId);
  state.recoveries.push({ connectionId: conn.id, at: now + (1.5 + rng.next() * 2) * MINUTE });
  const loc = world.db.locations.find((l) => l.id === conn.locationId);
  feed(state, "channel_incident", `${channelName(conn.channel)} degraded at ${loc?.name ?? ""}`, now);
}

async function runTick(db: Db, orgId: string, now: number, force: boolean, inject?: { channel?: OrderChannel; locationId?: string }) {
  const state = await loadState(db, orgId);
  if (!state) return { created: [] as UnifiedOrder[] };
  if (!force && now - state.lastTickAt < MIN_TICK_MS) return { created: [] as UnifiedOrder[] };

  const repos = createRepositories(db, orgId, { financials: true });
  const rng = createRng((now ^ state.externalSequence) >>> 0);
  const runtime = await loadChannelRuntime(repos, { inboxes: state.inboxes, rng: rng.next });
  const world = await loadWorld(repos, runtime, state);
  const demo = world.settings.demo;

  let injected: { channel: OrderChannel; locationId: string } | null = null;
  if (inject) injected = emit(world, runtime, rng, now, inject);

  if (demo.enabled) {
    if (now - state.nextOrderAt > MAX_SPAWN_PER_TICK * demo.orderIntervalSeconds * 1000) state.nextOrderAt = now;
    let spawned = 0;
    while (state.nextOrderAt <= now && spawned < MAX_SPAWN_PER_TICK) {
      emit(world, runtime, rng, Math.min(now, state.nextOrderAt));
      spawned += 1;
      state.nextOrderAt += demo.orderIntervalSeconds * 1000 * (0.5 + rng.next());
    }
    await incidents(repos, runtime, world, state, rng, now);
  }

  const created = await ingestPendingOrders(db, repos, runtime, world.ic, { kind: "system", label: "simulator" }, now);
  for (const o of created) {
    const loc = world.db.locations.find((l) => l.id === o.locationId);
    feed(state, "order_received", `${channelName(o.channel)} order ${o.orderNumber} · ${loc?.name ?? ""}`, now);
  }

  if (injected) {
    // Presenter-injected orders are never auto-progressed by the simulator.
    for (const o of created.filter((x) => x.channel === injected!.channel && x.locationId === injected!.locationId)) {
      o.metadata = { ...o.metadata, demoHold: true };
      await repos.orders.setMetadata(o.id, o.metadata);
    }
  }

  if (demo.enabled) {
    const candidates = await repos.orders.list({
      locationIds: world.db.locations.map((l) => l.id),
      statuses: ["new", "accepted", "preparing", "ready", "picked_up"],
      placedFrom: now - 6 * 60 * MINUTE,
      withItems: true,
    });
    for (const order of candidates) {
      const action = nextAutoAction(order, now, demo.autoProgress);
      // An unresolved inventory shortfall waits for a person; the simulator never resolves it.
      if (!action || blockedByShortfall(order, action)) continue;
      const res = await transitionOrder({ repos, actor: SIMULATOR, channels: runtime, mode: "system", rng: rng.next }, order.id, action, { at: now });
      if (action === "accept" || action === "mark_ready") feed(state, "status_change", `${res.order.orderNumber} → ${res.order.status.replace("_", " ")}`, now);
    }
  }

  await runtime.backend.flush(repos, "system");
  state.externalSequence = (world.db.counters as { externalSequence: number }).externalSequence;
  state.lastTickAt = now;
  await saveState(db, orgId, state);
  return { created, injected };
}

const lastTick = new Map<string, number>();

/**
 * Advance the Demo Workspace simulation to now. Safe to call on every request:
 * throttled in-process and serialized across processes with an advisory lock.
 * Never runs for non-demo organizations or when APP_MODE=production.
 */
export async function tickDemoWorkspace(orgId: string, now = Date.now()) {
  if (appMode() !== "demo") return;
  if (now - (lastTick.get(orgId) ?? 0) < MIN_TICK_MS) return;
  lastTick.set(orgId, now);
  await withSystemTransaction(async (db) => {
    const [org] = await db`select is_demo from public.organizations where id = ${orgId}`;
    if (!org?.is_demo) return;
    const [lock] = await db`select pg_try_advisory_xact_lock(hashtext(${"cornerops:demo-tick:" + orgId})) as ok`;
    if (!lock.ok) return;
    await runTick(db, orgId, now, false);
  });
}

/** Presenter tool: a customer places an order on a simulated platform; it is ingested immediately. */
export async function injectDemoOrder(orgId: string, opts: { channel?: OrderChannel; locationId?: string }, now = Date.now()) {
  return withSystemTransaction(async (db) => {
    const [org] = await db`select is_demo from public.organizations where id = ${orgId}`;
    if (!org?.is_demo) throw new Error("not a demo workspace");
    await db`select pg_advisory_xact_lock(hashtext(${"cornerops:demo-tick:" + orgId}))`;
    const { created, injected } = await runTick(db, orgId, now, true, opts);
    if (!injected) return { order: null, queued: false, unavailable: true };
    const order = created.find((o) => o.channel === injected.channel && o.locationId === injected.locationId) ?? null;
    return { order, queued: !order, unavailable: false };
  });
}

/**
 * Recent simulation feed for the Demo mode panel (read-only, newest first).
 * Runs on the caller's connection/transaction — `demo_feed` checks membership.
 */
export async function getDemoFeed(orgId: string, limit: number, db: Db): Promise<SimulationEvent[]> {
  const [r] = await db`select public.demo_feed(${orgId}, ${limit}) as events`;
  return (r?.events as SimulationEvent[]) ?? [];
}
