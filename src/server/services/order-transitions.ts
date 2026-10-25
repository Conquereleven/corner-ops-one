import { ORDER_STATUS_EVENT } from "@/domain/events/types";
import { stockStatus } from "@/domain/inventory/types";
import { applyTransition, InvalidTransitionError, type OrderAction } from "@/domain/orders/state-machine";
import type { UnifiedOrder } from "@/domain/orders/types";
import { iso } from "@/lib/time";
import type { ChannelRuntime } from "../demo/backend-session";
import type { Actor } from "../db/transaction";
import { ConflictError, NotFoundError } from "../errors";
import type { Repositories } from "../repositories";

export interface TransitionDeps {
  repos: Repositories;
  actor: Actor;
  channels: ChannelRuntime;
  /** "user" for staff actions (RLS), "system" for the simulator. */
  mode: "user" | "system";
  rng?: () => number;
}

export interface TransitionResult {
  order: UnifiedOrder;
  sync: { ok: boolean; externalStatus: string; error?: string };
}

const RIDERS = ["Imran", "Bilal", "Sameer", "Kiran", "Faisal", "Noel"];

const lifecycle = (o: UnifiedOrder) => ({
  status: o.status,
  acceptedAt: o.acceptedAt ?? null,
  preparationStartedAt: o.preparationStartedAt ?? null,
  readyAt: o.readyAt ?? null,
  pickedUpAt: o.pickedUpAt ?? null,
  completedAt: o.completedAt ?? null,
  cancelledAt: o.cancelledAt ?? null,
  cancellationReason: o.cancellationReason ?? null,
});

/**
 * The single path for changing an order's status — staff actions and the demo
 * simulator alike. Runs inside the caller's transaction: the order row is
 * locked, the state machine applied, inventory consumed on first acceptance,
 * the change written back to the channel, and a domain event + audit entry
 * recorded. Either all of it commits or none of it does.
 */
export async function transitionOrder(
  deps: TransitionDeps,
  orderId: string,
  action: OrderAction,
  opts: { reason?: string; at?: number } = {},
): Promise<TransitionResult> {
  const { repos, actor } = deps;
  const at = opts.at ?? Date.now();
  const order = await repos.orders.findById(orderId, { forUpdate: true });
  if (!order) throw new NotFoundError("Order");

  let next: UnifiedOrder;
  try {
    next = applyTransition(order, action, iso(at), { reason: opts.reason });
  } catch (err) {
    if (err instanceof InvalidTransitionError) throw new ConflictError(err.message);
    throw err;
  }

  // First acceptance: consume recipe ingredients and assign a courier.
  if (!order.acceptedAt && next.acceptedAt) {
    const usage = await repos.inventory.applyOrderUsage(order.id, actor.kind === "user" ? "user" : actor.label);
    for (const u of usage) {
      const before = stockStatus({ quantity: u.beforeQuantity, threshold: u.threshold });
      const after = stockStatus({ quantity: u.afterQuantity, threshold: u.threshold });
      if (after === before) continue;
      if (after === "out" || after === "low") {
        await repos.events.append(
          {
            type: after === "out" ? "inventory.out_of_stock" : "inventory.low",
            aggregateType: "inventory_item",
            aggregateId: u.inventoryItemId,
            locationId: u.locationId,
            payload: { name: u.itemName, quantity: u.afterQuantity, threshold: u.threshold, unit: u.unit, causedByOrder: order.orderNumber },
          },
          actor,
        );
      }
    }
    const pick = () => RIDERS[Math.floor((deps.rng ?? Math.random)() * RIDERS.length)];
    if (next.courier?.provider === "platform" && next.courier.status === "unassigned") next.courier = { ...next.courier, status: "assigned", name: pick() };
    if (next.courier?.provider === "restaurant") next.courier = { ...next.courier, status: "assigned", name: "In-house driver" };
  }

  const history = Array.isArray(order.metadata?.history) ? (order.metadata!.history as unknown[]) : [];
  next.metadata = {
    ...next.metadata,
    ...(actor.kind === "user" ? { manual: true } : {}),
    history: [...history, { action, at: iso(at), by: actor.kind === "user" ? actor.userId : actor.label }],
  };

  // Write back to the originating channel (mock adapters in v0.2).
  const result = await deps.channels.adapters[order.channel].updateOrderStatus(next, next.status);
  next.syncStatus = result.ok ? "synced" : "failed";

  await repos.orders.update(next);
  await repos.events.append(
    {
      type: ORDER_STATUS_EVENT[next.status],
      aggregateType: "order",
      aggregateId: next.id,
      locationId: next.locationId,
      payload: {
        orderNumber: next.orderNumber,
        channel: next.channel,
        externalOrderId: next.externalOrderId,
        from: order.status,
        to: next.status,
        reason: next.cancellationReason,
        channelSync: { ok: result.ok, externalStatus: result.externalStatus },
      },
    },
    actor,
  );
  await repos.audit.record(
    {
      action: action === "cancel" ? "order.cancelled" : "order.status_changed",
      entityType: "order",
      entityId: next.id,
      locationId: next.locationId,
      before: lifecycle(order),
      after: lifecycle(next),
      metadata: { orderNumber: next.orderNumber, channel: next.channel, action, reason: opts.reason ?? null },
    },
    actor,
  );
  await deps.channels.backend.flush(repos, deps.mode);

  return { order: next, sync: { ok: result.ok, externalStatus: result.externalStatus, error: result.error } };
}
