import type { ChannelConnection, ConnectionStatus } from "@/domain/channels/types";
import { ORDER_CHANNELS } from "@/domain/channels/types";
import type { UnifiedOrder } from "@/domain/orders/types";

const RANK: Record<ConnectionStatus, number> = { connected: 0, degraded: 1, disconnected: 2 };

/** Per-channel connection health across the given connections (already scoped). */
export function channelHealthSummary(connections: ChannelConnection[], today: UnifiedOrder[]) {
  return ORDER_CHANNELS.map((channel) => {
    const conns = connections.filter((c) => c.channel === channel);
    const worst = conns.reduce<ConnectionStatus>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), "connected");
    const allDown = conns.length > 0 && conns.every((c) => c.status === "disconnected");
    const lastSyncAt = conns.map((c) => c.lastSyncAt).filter((v): v is string => !!v).sort().at(-1) ?? null;
    return {
      channel,
      status: (conns.length === 0 || allDown ? "disconnected" : worst === "connected" ? "connected" : "degraded") as ConnectionStatus,
      covered: conns.length > 0,
      latencyMs: conns.length ? Math.round(conns.reduce((s, c) => s + c.latencyMs, 0) / conns.length) : 0,
      lastSyncAt,
      ordersToday: today.filter((o) => o.channel === channel).length,
      message: conns.find((c) => c.status !== "connected")?.message,
    };
  });
}
