import type { OrderChannel } from "@/domain/channels/types";
import type {
  FulfillmentType,
  OrderCourier,
  PaymentMethod,
  UnifiedOrder,
  UnifiedOrderItem,
} from "@/domain/orders/types";
import { round2 } from "@/lib/rng";
import { iso } from "@/lib/time";
import { AdapterError, type NormalizationContext } from "../types";

export interface NormalizedParts {
  channel: OrderChannel;
  externalOrderId: string;
  externalStoreId: string;
  placedAt: string;
  fulfillment: FulfillmentType;
  paymentMethod: PaymentMethod;
  customer?: { name?: string; phone?: string };
  lines: Omit<UnifiedOrderItem, "id" | "menuItemId" | "total">[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  platformFee?: number;
  tax: number;
  total: number;
  notes?: string;
  courierProvider: OrderCourier["provider"];
  metadata: Record<string, unknown>;
}

/** Shared tail of every normalizer: resolve CornerOps references and assemble the UnifiedOrder. */
export function buildUnifiedOrder(parts: NormalizedParts, ctx: NormalizationContext): UnifiedOrder {
  const locationId = ctx.resolveLocationId(parts.channel, parts.externalStoreId);
  if (!locationId) {
    throw new AdapterError(parts.channel, `Unknown store ${parts.externalStoreId}`);
  }
  const items: UnifiedOrderItem[] = parts.lines.map((line) => {
    const modifierTotal = line.modifiers.reduce((s, m) => s + m.price, 0);
    return {
      ...line,
      id: ctx.newId("oi"),
      menuItemId: line.externalItemId ? ctx.resolveMenuItemId(parts.channel, line.externalItemId) : undefined,
      total: round2((line.unitPrice + modifierTotal) * line.quantity),
    };
  });
  const nowIso = iso(ctx.now);
  return {
    id: ctx.newId("ord"),
    orderNumber: ctx.allocateOrderNumber(),
    externalOrderId: parts.externalOrderId,
    organizationId: ctx.organizationId,
    restaurantId: ctx.restaurantId,
    locationId,
    channel: parts.channel,
    status: "new",
    fulfillment: parts.fulfillment,
    customer: parts.customer,
    items,
    subtotal: round2(parts.subtotal),
    discount: round2(parts.discount),
    deliveryFee: round2(parts.deliveryFee),
    platformFee: parts.platformFee === undefined ? undefined : round2(parts.platformFee),
    tax: round2(parts.tax),
    total: round2(parts.total),
    paymentMethod: parts.paymentMethod,
    estimatedPrepMinutes: ctx.estimatePrepMinutes(items.map((i) => i.menuItemId)),
    notes: parts.notes,
    courier:
      parts.fulfillment === "delivery"
        ? { provider: parts.courierProvider, status: "unassigned" }
        : undefined,
    placedAt: parts.placedAt,
    syncStatus: "synced",
    source: "mock",
    createdAt: nowIso,
    updatedAt: nowIso,
    metadata: parts.metadata,
  };
}

export function specTotals(spec: {
  lines: { quantity: number; unitPrice: number; modifiers: { price: number }[] }[];
  discount: number;
  deliveryFee: number;
}) {
  const subtotal = round2(
    spec.lines.reduce((s, l) => s + (l.unitPrice + l.modifiers.reduce((m, x) => m + x.price, 0)) * l.quantity, 0),
  );
  const discount = round2(Math.min(spec.discount, subtotal));
  const tax = round2((subtotal - discount) * 0.05);
  const total = round2(subtotal - discount + spec.deliveryFee + tax);
  return { subtotal, discount, tax, total };
}
