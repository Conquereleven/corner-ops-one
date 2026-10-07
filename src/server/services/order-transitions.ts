import type { OrderAction } from "@/domain/orders/state-machine";
import { applyTransition } from "@/domain/orders/state-machine";
import type { UnifiedOrder } from "@/domain/orders/types";
import { iso } from "@/lib/time";
import { consumeInventoryForOrder, replaceOrder } from "../store/order-helpers";
import type { Runtime } from "../store/runtime";

export type Actor = { type: "user"; userId: string } | { type: "simulator" };

export interface TransitionResult {
  order: UnifiedOrder;
  sync: { ok: boolean; externalStatus: string; error?: string };
}

/**
 * The single path for changing an order's status — used by staff actions and
 * the demo simulator alike. Applies the state machine, side effects
 * (inventory, courier), and writes the status back to the originating channel.
 */
export async function transitionOrder(
  rt: Runtime,
  order: UnifiedOrder,
  action: OrderAction,
  actor: Actor,
  opts: { reason?: string; at?: number } = {},
): Promise<TransitionResult> {
  const at = opts.at ?? Date.now();
  const next = applyTransition(order, action, iso(at), { reason: opts.reason });

  if (!order.acceptedAt && next.acceptedAt) {
    consumeInventoryForOrder(rt.db, next, at);
    if (next.courier && next.courier.provider === "platform" && next.courier.status === "unassigned") {
      next.courier = { ...next.courier, status: "assigned", name: rt.rng.pick(["Imran", "Bilal", "Sameer", "Kiran", "Faisal", "Noel"]) };
    }
    if (next.courier && next.courier.provider === "restaurant") {
      next.courier = { ...next.courier, status: "assigned", name: "In-house driver" };
    }
  }

  const history = Array.isArray(order.metadata?.history) ? (order.metadata!.history as unknown[]) : [];
  next.metadata = {
    ...next.metadata,
    ...(actor.type === "user" ? { manual: true } : {}),
    history: [...history, { action, at: iso(at), by: actor.type === "user" ? actor.userId : "simulator" }],
  };

  const adapter = rt.adapters[order.channel];
  const result = await adapter.updateOrderStatus(next, next.status);
  next.syncStatus = result.ok ? "synced" : "failed";
  replaceOrder(rt.db, next);

  return { order: next, sync: { ok: result.ok, externalStatus: result.externalStatus, error: result.error } };
}
