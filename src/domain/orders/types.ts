import { z } from "zod";
import { orderChannelSchema, type OrderChannel } from "../channels/types";

export const ORDER_STATUSES = [
  "new",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
  "completed",
  "cancelled",
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const ACTIVE_STATUSES: readonly OrderStatus[] = ["new", "accepted", "preparing", "ready"];
export const KITCHEN_STATUSES: readonly OrderStatus[] = ["new", "accepted", "preparing", "ready"];

export type FulfillmentType = "delivery" | "pickup";
export type PaymentMethod = "card_online" | "apple_pay" | "cash_on_delivery" | "wallet" | "payment_link";
export type CourierStatus = "unassigned" | "assigned" | "arriving" | "at_restaurant" | "picked_up" | "delivered";
export type SyncStatus = "synced" | "pending" | "failed";

export interface UnifiedOrderModifier {
  name: string;
  price: number;
}

export interface UnifiedOrderItem {
  id: string;
  /** CornerOps master-menu item, when the external item could be mapped. */
  menuItemId?: string;
  externalItemId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: UnifiedOrderModifier[];
  notes?: string;
  total: number;
}

export interface OrderCustomer {
  id?: string;
  name?: string;
  phone?: string;
}

export interface OrderCourier {
  name?: string;
  status: CourierStatus;
  etaMinutes?: number;
  /** Who delivers: the platform's fleet or the restaurant's own. */
  provider: "platform" | "restaurant";
}

/**
 * The normalized CornerOps order. Every screen consumes this shape — never a
 * Talabat/Deliveroo/Noon/Keeta payload. Platform specifics live in `metadata`.
 */
export interface UnifiedOrder {
  id: string;
  /** Human-facing CornerOps order number, e.g. CO-20391. */
  orderNumber: string;
  externalOrderId: string;

  organizationId: string;
  restaurantId: string;
  locationId: string;

  channel: OrderChannel;
  status: OrderStatus;
  fulfillment: FulfillmentType;

  customer?: OrderCustomer;
  items: UnifiedOrderItem[];

  subtotal: number;
  discount: number;
  deliveryFee: number;
  platformFee?: number;
  tax: number;
  total: number;

  paymentMethod: PaymentMethod;
  estimatedPrepMinutes: number;
  notes?: string;
  courier?: OrderCourier;

  placedAt: string;
  acceptedAt?: string;
  preparationStartedAt?: string;
  readyAt?: string;
  pickedUpAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;

  /** Status of the last write-back to the originating channel. */
  syncStatus: SyncStatus;
  /** Recipe stock that could not be consumed on acceptance; "open" blocks fulfilment until resolved. */
  inventoryShortfall?: "open" | "resolved";
  /** "mock" orders were produced by a simulated integration. */
  source: "mock" | "live" | "seed";

  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

/** One ingredient's unmet recipe demand for an accepted order. */
export interface OrderShortfallLine {
  id: string;
  inventoryItemId?: string;
  ingredientKey: string;
  unit?: string;
  requestedQuantity: number;
  consumedQuantity: number;
  unmetQuantity: number;
  status: "open" | "resolved";
  resolution?: "reconciled_from_stock" | "accepted_shortfall";
  resolutionNote?: string;
  resolvedAt?: string;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  picked_up: "Picked up",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  card_online: "Card (online)",
  apple_pay: "Apple Pay",
  cash_on_delivery: "Cash on delivery",
  wallet: "Platform wallet",
  payment_link: "Payment link",
};

export function isActive(order: Pick<UnifiedOrder, "status">): boolean {
  return ACTIVE_STATUSES.includes(order.status);
}

/** Net food sales: what the restaurant sold, after discounts, before VAT & fees. */
export function netSales(order: Pick<UnifiedOrder, "subtotal" | "discount">): number {
  return order.subtotal - order.discount;
}

export const orderFiltersSchema = z.object({
  location: z.string().optional(),
  channel: orderChannelSchema.optional(),
  status: z.union([orderStatusSchema, z.enum(["active", "all"])]).optional(),
  range: z.enum(["live", "today", "yesterday", "7d"]).optional(),
  delayed: z.coerce.boolean().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type OrderFilters = z.infer<typeof orderFiltersSchema>;
