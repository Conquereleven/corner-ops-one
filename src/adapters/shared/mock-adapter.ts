import type { ChannelHealth, ConnectionStatus, OrderChannel } from "@/domain/channels/types";
import type { OrderStatus, UnifiedOrder } from "@/domain/orders/types";
import { iso } from "@/lib/time";
import {
  AdapterError,
  type ChannelAdapter,
  type MockOrderSpec,
  type MockPlatformBackend,
  type NormalizationContext,
  type StatusUpdateResult,
} from "../types";

export interface MockAdapterConfig<TExternal> {
  channel: OrderChannel;
  /** Renders a spec into the platform's own payload shape. */
  fabricate(spec: MockOrderSpec): TExternal;
  /** Pure mapping from the platform payload to a UnifiedOrder. */
  normalize(external: unknown, ctx: NormalizationContext): UnifiedOrder;
  /** Platform vocabulary for CornerOps statuses. */
  statusMap: Partial<Record<OrderStatus, string>>;
  /** Typical API latency of the simulated platform. */
  baseLatencyMs: number;
}

const STATUS_RANK: Record<ConnectionStatus, number> = { connected: 0, degraded: 1, disconnected: 2 };

/**
 * MOCK integration. Simulates a delivery platform's API against an in-memory
 * backend: no network calls, no credentials. Replace with a live adapter that
 * implements the same ChannelAdapter interface.
 */
export class MockChannelAdapter<TExternal = unknown> implements ChannelAdapter {
  readonly mode = "mock" as const;
  readonly channel: OrderChannel;

  constructor(
    private readonly config: MockAdapterConfig<TExternal>,
    private readonly backend: MockPlatformBackend,
  ) {
    this.channel = config.channel;
  }

  /** Mock-only: a customer places an order on the simulated platform. */
  emitOrder(spec: MockOrderSpec): TExternal {
    const payload = this.config.fabricate(spec);
    this.backend.pushInbox(this.channel, payload);
    return payload;
  }

  /** Mock-only: render a payload without queueing it (used by the seed generator). */
  fabricate(spec: MockOrderSpec): TExternal {
    return this.config.fabricate(spec);
  }

  async connect(locationId?: string) {
    this.backend.setConnectionStatus(this.channel, "connected", { locationId, latencyMs: this.config.baseLatencyMs });
    this.backend.log(this.channel, "info", "Connection established (mock integration)", locationId);
  }

  async disconnect(locationId?: string) {
    this.backend.setConnectionStatus(this.channel, "disconnected", { locationId, message: "Disconnected by user" });
    this.backend.log(this.channel, "warning", "Integration disconnected by user", locationId);
  }

  async getOrders(ctx: NormalizationContext): Promise<UnifiedOrder[]> {
    const connections = this.backend.getConnections(this.channel);
    if (connections.length > 0 && connections.every((c) => c.status === "disconnected")) return [];
    const payloads = this.backend.drainInbox(this.channel);
    const orders: UnifiedOrder[] = [];
    for (const payload of payloads) {
      try {
        const order = this.normalizeOrder(payload, ctx);
        const conn = connections.find((c) => c.locationId === order.locationId);
        if (conn?.status === "disconnected") {
          // Platform keeps the order; it will be delivered once reconnected.
          this.backend.pushInbox(this.channel, payload);
          continue;
        }
        orders.push(order);
        this.backend.recordSync(this.channel, order.locationId);
      } catch (err) {
        this.backend.log(this.channel, "error", `Rejected payload: ${(err as Error).message}`);
      }
    }
    return orders;
  }

  normalizeOrder(externalOrder: unknown, ctx: NormalizationContext): UnifiedOrder {
    return this.config.normalize(externalOrder, ctx);
  }

  async updateOrderStatus(
    order: Pick<UnifiedOrder, "id" | "externalOrderId" | "locationId">,
    status: OrderStatus,
  ): Promise<StatusUpdateResult> {
    const externalStatus = this.config.statusMap[status] ?? status.toUpperCase();
    const conn = this.backend.getConnections(this.channel).find((c) => c.locationId === order.locationId);
    const latencyMs = Math.round(this.config.baseLatencyMs * (0.7 + this.backend.random() * 0.8) + (conn?.latencyMs ?? 0) * 0.2);

    if (conn?.status === "disconnected") {
      const error = `Status ${externalStatus} not delivered — integration disconnected`;
      this.backend.log(this.channel, "error", `${order.externalOrderId}: ${error}`, order.locationId);
      return { ok: false, externalStatus, latencyMs: 0, error };
    }
    if (conn?.status === "degraded" && this.backend.random() < 0.25) {
      const error = `Timeout after ${latencyMs + 3000}ms updating ${order.externalOrderId}; will retry`;
      this.backend.log(this.channel, "warning", error, order.locationId);
      return { ok: false, externalStatus, latencyMs: latencyMs + 3000, error };
    }
    this.backend.log(
      this.channel,
      "info",
      `${order.externalOrderId} → ${externalStatus} (${latencyMs}ms, simulated)`,
      order.locationId,
    );
    this.backend.recordSync(this.channel, order.locationId);
    return { ok: true, externalStatus, latencyMs };
  }

  async getHealth(): Promise<ChannelHealth> {
    const conns = this.backend.getConnections(this.channel);
    if (conns.length === 0) {
      throw new AdapterError(this.channel, "No store connections configured");
    }
    const worst = conns.reduce((w, c) => (STATUS_RANK[c.status] > STATUS_RANK[w.status] ? c : w), conns[0]);
    const lastSync = conns
      .map((c) => c.lastSyncAt)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1);
    const live = conns.filter((c) => c.status !== "disconnected");
    return {
      channel: this.channel,
      status: live.length === 0 ? "disconnected" : worst.status === "connected" ? "connected" : "degraded",
      latencyMs: Math.round(live.reduce((s, c) => s + c.latencyMs, 0) / Math.max(1, live.length)),
      lastSyncAt: lastSync ?? null,
      errorCount: conns.reduce((s, c) => s + c.errorCount, 0),
      message: worst.message,
    };
  }
}

export function isoFromSpec(spec: MockOrderSpec): string {
  return iso(spec.placedAt);
}
