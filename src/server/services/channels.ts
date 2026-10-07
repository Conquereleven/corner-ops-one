import "server-only";
import { z } from "zod";
import { summarize } from "@/domain/analytics/metrics";
import {
  CHANNEL_CATALOG,
  ORDER_CHANNELS,
  type ConnectionStatus,
  type OrderChannel,
} from "@/domain/channels/types";
import type { LocationScope } from "@/domain/locations/types";
import type { UnifiedOrder } from "@/domain/orders/types";
import { DAY, toMs } from "@/lib/time";
import type { Runtime } from "../store/runtime";
import { inScope, live, NotFoundError, ordersBetween, todayWindow } from "./context";

const RANK: Record<ConnectionStatus, number> = { connected: 0, degraded: 1, disconnected: 2 };

export function channelHealthSummary(rt: Runtime, scope: LocationScope, today: UnifiedOrder[]) {
  return ORDER_CHANNELS.map((channel) => {
    const conns = rt.db.channelConnections.filter((c) => c.channel === channel && inScope(scope, c.locationId));
    const worst = conns.reduce<ConnectionStatus>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), "connected");
    const allDown = conns.length > 0 && conns.every((c) => c.status === "disconnected");
    const lastSyncAt = conns.map((c) => c.lastSyncAt).filter((v): v is string => !!v).sort().at(-1) ?? null;
    const list = today.filter((o) => o.channel === channel);
    return {
      channel,
      status: (conns.length === 0 ? "disconnected" : allDown ? "disconnected" : worst === "connected" ? "connected" : "degraded") as ConnectionStatus,
      covered: conns.length > 0,
      latencyMs: conns.length ? Math.round(conns.reduce((s, c) => s + c.latencyMs, 0) / conns.length) : 0,
      lastSyncAt,
      ordersToday: list.length,
      message: conns.find((c) => c.status !== "connected")?.message,
    };
  });
}

export async function getChannels(scope: LocationScope) {
  const rt = await live();
  const now = Date.now();
  const { db } = rt;
  const { start, yStart, yEnd } = todayWindow(now);
  const today = ordersBetween(rt, scope, start, now + 1);
  const yesterday = ordersBetween(rt, scope, yStart, yEnd);
  const health = channelHealthSummary(rt, scope, today);

  return ORDER_CHANNELS.map((channel) => {
    const h = health.find((x) => x.channel === channel)!;
    const t = summarize(today.filter((o) => o.channel === channel));
    const y = summarize(yesterday.filter((o) => o.channel === channel));
    const connections = db.channelConnections
      .filter((c) => c.channel === channel)
      .map((c) => ({
        id: c.id,
        locationId: c.locationId,
        externalStoreId: c.externalStoreId,
        status: c.status,
        mode: c.mode,
        latencyMs: c.latencyMs,
        lastSyncAt: c.lastSyncAt,
        errorCount: c.errorCount,
        message: c.message,
      }));
    const errors24h = db.channelLogs.filter(
      (l) => l.channel === channel && l.level === "error" && (toMs(l.at) ?? 0) > now - DAY,
    ).length;
    const mappings = db.menuMappings.filter((m) => m.channel === channel);
    return {
      channel,
      name: CHANNEL_CATALOG[channel].name,
      kind: CHANNEL_CATALOG[channel].kind,
      mode: "mock" as const,
      status: h.status,
      lastSyncAt: h.lastSyncAt,
      latencyMs: h.latencyMs,
      ordersToday: t.orders,
      revenueToday: t.revenue,
      revenueYesterday: y.revenue,
      cancellationRate: t.cancellationRate,
      errors24h,
      coverage: { connected: connections.filter((c) => c.status !== "disconnected").length, configured: connections.length, total: db.locations.length },
      menu: { synced: mappings.filter((m) => m.status === "synced").length, total: mappings.length },
      connections,
      message: h.message,
    };
  });
}
export type ChannelsData = Awaited<ReturnType<typeof getChannels>>;

export const connectionActionSchema = z.object({
  action: z.enum(["connect", "disconnect", "reconnect"]),
  locationId: z.string().optional(),
});

export async function runConnectionAction(channel: OrderChannel, input: z.infer<typeof connectionActionSchema>) {
  const rt = await live();
  if (input.locationId && !rt.db.channelConnections.some((c) => c.channel === channel && c.locationId === input.locationId)) {
    throw new NotFoundError("Connection");
  }
  const adapter = rt.adapters[channel];
  if (input.action === "disconnect") await adapter.disconnect(input.locationId);
  else {
    if (input.action === "reconnect") {
      rt.db.channelLogs.push({ id: `log_rc_${Date.now()}`, channel, level: "info", message: "Reconnecting… (mock handshake)", locationId: input.locationId, at: new Date().toISOString() });
    }
    await adapter.connect(input.locationId);
    // Orders that queued on the platform while disconnected are delivered now.
  }
  return adapter.getHealth();
}

export async function getChannelLogs(channel: OrderChannel, limit = 60) {
  const rt = await live();
  return rt.db.channelLogs
    .filter((l) => l.channel === channel)
    .slice(-limit)
    .reverse();
}
