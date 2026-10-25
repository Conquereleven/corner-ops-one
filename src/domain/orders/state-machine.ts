import { z } from "zod";
import type { OrderStatus, UnifiedOrder } from "./types";

export const ORDER_ACTIONS = [
  "accept",
  "start_preparing",
  "mark_ready",
  "mark_picked_up",
  "complete",
  "cancel",
] as const;
export const orderActionSchema = z.enum(ORDER_ACTIONS);
export type OrderAction = z.infer<typeof orderActionSchema>;

interface TransitionRule {
  from: readonly OrderStatus[];
  to: OrderStatus;
  label: string;
  destructive?: boolean;
}

export const TRANSITIONS: Record<OrderAction, TransitionRule> = {
  accept: { from: ["new"], to: "accepted", label: "Accept" },
  start_preparing: { from: ["new", "accepted"], to: "preparing", label: "Start preparing" },
  mark_ready: { from: ["accepted", "preparing"], to: "ready", label: "Mark ready" },
  mark_picked_up: { from: ["ready"], to: "picked_up", label: "Mark picked up" },
  complete: { from: ["ready", "picked_up"], to: "completed", label: "Complete" },
  cancel: { from: ["new", "accepted", "preparing", "ready"], to: "cancelled", label: "Cancel order", destructive: true },
};

export function canTransition(status: OrderStatus, action: OrderAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}

/** Fulfilment steps that stay blocked while an inventory shortfall is unresolved. */
export const SHORTFALL_BLOCKED_ACTIONS: readonly OrderAction[] = ["mark_ready", "mark_picked_up", "complete"];

export function blockedByShortfall(order: Pick<UnifiedOrder, "inventoryShortfall">, action: OrderAction): boolean {
  return order.inventoryShortfall === "open" && SHORTFALL_BLOCKED_ACTIONS.includes(action);
}

export function availableActions(order: Pick<UnifiedOrder, "status" | "fulfillment" | "inventoryShortfall">): OrderAction[] {
  return ORDER_ACTIONS.filter((a) => {
    if (!canTransition(order.status, a)) return false;
    if (blockedByShortfall(order, a)) return false;
    // Delivery orders are completed after courier pickup; pickup orders complete from ready.
    return !(a === "complete" && order.status === "ready" && order.fulfillment === "delivery");
  });
}

/** The single most likely next step, used for one-click primary buttons. */
export function primaryAction(order: Pick<UnifiedOrder, "status" | "fulfillment">): OrderAction | null {
  switch (order.status) {
    case "new":
      return "accept";
    case "accepted":
      return "start_preparing";
    case "preparing":
      return "mark_ready";
    case "ready":
      return "mark_picked_up";
    case "picked_up":
      return "complete";
    default:
      return null;
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: OrderStatus, action: OrderAction) {
    super(`Cannot ${TRANSITIONS[action].label.toLowerCase()} an order that is ${from.replace("_", " ")}.`);
    this.name = "InvalidTransitionError";
  }
}

/** Pure transition: returns a new order with status and lifecycle timestamps applied. */
export function applyTransition(
  order: UnifiedOrder,
  action: OrderAction,
  atIso: string,
  opts: { reason?: string } = {},
): UnifiedOrder {
  if (!canTransition(order.status, action)) throw new InvalidTransitionError(order.status, action);
  const next: UnifiedOrder = { ...order, status: TRANSITIONS[action].to, updatedAt: atIso };
  switch (action) {
    case "accept":
      next.acceptedAt = atIso;
      break;
    case "start_preparing":
      next.acceptedAt ??= atIso;
      next.preparationStartedAt = atIso;
      break;
    case "mark_ready":
      next.preparationStartedAt ??= atIso;
      next.readyAt = atIso;
      if (next.courier && next.courier.status === "assigned") next.courier = { ...next.courier, status: "arriving" };
      break;
    case "mark_picked_up":
      next.pickedUpAt = atIso;
      if (next.courier) next.courier = { ...next.courier, status: "picked_up" };
      break;
    case "complete":
      next.pickedUpAt ??= atIso;
      next.completedAt = atIso;
      if (next.courier) next.courier = { ...next.courier, status: "delivered" };
      break;
    case "cancel":
      next.cancelledAt = atIso;
      next.cancellationReason = opts.reason?.trim() || "Cancelled by restaurant";
      break;
  }
  return next;
}
