import type {
  ChannelConnection,
  ChannelHealth,
  ChannelLogLevel,
  ConnectionStatus,
  IntegrationMode,
  OrderChannel,
} from "@/domain/channels/types";
import type { OrderStatus, UnifiedOrder } from "@/domain/orders/types";

/**
 * Everything an adapter needs from CornerOps to turn an external payload into a
 * UnifiedOrder. Adapters never import the store directly.
 */
export interface NormalizationContext {
  organizationId: string;
  restaurantId: string;
  resolveLocationId(channel: OrderChannel, externalStoreId: string): string | undefined;
  resolveMenuItemId(channel: OrderChannel, externalItemId: string): string | undefined;
  estimatePrepMinutes(menuItemIds: (string | undefined)[]): number;
  allocateOrderNumber(): string;
  newId(prefix: string): string;
  /** Ingestion time (ms). */
  now: number;
}

export interface StatusUpdateResult {
  ok: boolean;
  externalStatus: string;
  latencyMs: number;
  error?: string;
}

/**
 * The contract every sales channel implements. The CornerOps core only talks
 * to channels through this interface, so swapping a mock for a real API
 * integration never touches domain logic or UI.
 */
export interface ChannelAdapter {
  readonly channel: OrderChannel;
  readonly mode: IntegrationMode;

  connect(locationId?: string): Promise<void>;
  disconnect(locationId?: string): Promise<void>;

  /** Pull new orders from the channel, already normalized. */
  getOrders(ctx: NormalizationContext): Promise<UnifiedOrder[]>;

  /** Map one external payload into the CornerOps UnifiedOrder model. */
  normalizeOrder(externalOrder: unknown, ctx: NormalizationContext): UnifiedOrder;

  /** Write a status change back to the channel. */
  updateOrderStatus(
    order: Pick<UnifiedOrder, "id" | "externalOrderId" | "locationId">,
    status: OrderStatus,
  ): Promise<StatusUpdateResult>;

  getHealth(): Promise<ChannelHealth>;
}

/** Simulated platform side of a mock integration (implemented by the demo store). */
export interface MockPlatformBackend {
  pushInbox(channel: OrderChannel, payload: unknown): void;
  drainInbox(channel: OrderChannel): unknown[];
  getConnections(channel: OrderChannel): ChannelConnection[];
  setConnectionStatus(
    channel: OrderChannel,
    status: ConnectionStatus,
    opts?: { locationId?: string; message?: string; latencyMs?: number },
  ): void;
  recordSync(channel: OrderChannel, locationId?: string): void;
  log(channel: OrderChannel, level: ChannelLogLevel, message: string, locationId?: string): void;
  random(): number;
}

/**
 * Channel-agnostic description of an order a customer placed on a platform.
 * Mock adapters render it into the platform's own payload format.
 */
export interface MockOrderSpec {
  externalStoreId: string;
  placedAt: number;
  sequence: number;
  lines: {
    externalItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    modifiers: { name: string; price: number }[];
    notes?: string;
  }[];
  discount: number;
  deliveryFee: number;
  fulfillment: "delivery" | "pickup";
  payment: "online" | "cash" | "apple_pay" | "link";
  customer: { name: string; phone: string };
  notes?: string;
}

export class AdapterError extends Error {
  constructor(
    public readonly channel: OrderChannel,
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export class IntegrationUnavailableError extends AdapterError {
  constructor(channel: OrderChannel) {
    super(channel, `A live ${channel} integration is not available in CornerOps v0.1. Use the mock integration.`);
    this.name = "IntegrationUnavailableError";
  }
}
