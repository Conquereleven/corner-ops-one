import "server-only";
import { z } from "zod";
import { summarize } from "@/domain/analytics/metrics";
import { CHANNEL_CATALOG, ORDER_CHANNELS, type OrderChannel } from "@/domain/channels/types";
import { DAY, iso } from "@/lib/time";
import { requireLocationAccess, requirePermission, type AppContext } from "../context/app-context";
import { loadChannelRuntime } from "../demo/backend-session";
import { NotFoundError } from "../errors";
import { channelHealthSummary } from "./channel-health";
import { todayWindow } from "./windows";

export async function getChannels(ctx: AppContext) {
  const now = ctx.now;
  const { start, yStart, yEnd } = todayWindow(now);
  const [today, yesterday, connections, { mappings }, errors] = await Promise.all([
    ctx.data.orders({ from: start, to: now + 1 }),
    ctx.data.orders({ from: yStart, to: yEnd }),
    ctx.data.connections(),
    ctx.data.menu(),
    ctx.repos.channels.errorCountSince(iso(now - DAY), ctx.scope.locationIds),
  ]);
  const health = channelHealthSummary(connections, today);
  const totalLocations = ctx.scope.locationIds.length;

  return ORDER_CHANNELS.map((channel) => {
    const h = health.find((x) => x.channel === channel)!;
    const t = summarize(today.filter((o) => o.channel === channel));
    const y = summarize(yesterday.filter((o) => o.channel === channel));
    const conns = connections
      .filter((c) => c.channel === channel)
      .map((c) => ({ id: c.id, locationId: c.locationId, externalStoreId: c.externalStoreId, status: c.status, mode: c.mode, latencyMs: c.latencyMs, lastSyncAt: c.lastSyncAt, errorCount: c.errorCount, message: c.message }));
    const maps = mappings.filter((m) => m.channel === channel);
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
      errors24h: errors[channel] ?? 0,
      coverage: { connected: conns.filter((c) => c.status !== "disconnected").length, configured: conns.length, total: totalLocations },
      menu: { synced: maps.filter((m) => m.status === "synced").length, total: maps.length },
      connections: conns,
      message: h.message,
      canManage: ctx.permissions.has("channels.manage"),
    };
  });
}
export type ChannelsData = Awaited<ReturnType<typeof getChannels>>;

export const connectionActionSchema = z.object({
  action: z.enum(["connect", "disconnect", "reconnect"]),
  locationId: z.string().optional(),
});

/** Change a (mock) integration's connection state; audited and evented per connection. */
export async function runConnectionAction(ctx: AppContext, channel: OrderChannel, input: z.infer<typeof connectionActionSchema>) {
  requirePermission(ctx, "channels.manage");
  if (input.locationId) requireLocationAccess(ctx, input.locationId);
  const locationIds = input.locationId ? [input.locationId] : ctx.allowedLocations.map((l) => l.id);
  const runtime = await loadChannelRuntime(ctx.repos, { locationIds });
  const before = new Map(runtime.backend.connections.filter((c) => c.channel === channel).map((c) => [c.id, { ...c }]));
  if (!before.size) throw new NotFoundError("Connection");

  const adapter = runtime.adapters[channel];
  if (input.action === "disconnect") {
    for (const c of before.values()) await adapter.disconnect(c.locationId);
  } else {
    if (input.action === "reconnect") runtime.backend.log(channel, "info", "Reconnecting… (mock handshake)", input.locationId);
    for (const c of before.values()) await adapter.connect(c.locationId);
  }
  for (const c of runtime.backend.changedConnections()) {
    const prev = before.get(c.id);
    if (!prev || prev.status === c.status) continue;
    await ctx.repos.events.append(
      {
        type: c.status === "connected" ? "channel.connected" : c.status === "disconnected" ? "channel.disconnected" : "channel.degraded",
        aggregateType: "channel_connection",
        aggregateId: c.id,
        locationId: c.locationId,
        payload: { channel, from: prev.status, to: c.status, mode: c.mode },
      },
      ctx.actor,
    );
    await ctx.repos.audit.record(
      { action: "channel.connection_changed", entityType: "channel_connection", entityId: c.id, locationId: c.locationId, before: { status: prev.status }, after: { status: c.status }, metadata: { channel, action: input.action, mode: c.mode } },
      ctx.actor,
    );
  }
  await runtime.backend.flush(ctx.repos, "user");
  return adapter.getHealth();
}

export async function getChannelLogs(ctx: AppContext, channel: OrderChannel, limit = 60) {
  return ctx.repos.channels.logs({ channel, locationIds: ctx.allowedLocations.map((l) => l.id), limit });
}
