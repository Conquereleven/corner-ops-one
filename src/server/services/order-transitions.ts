import { applyTransition, blockedByShortfall, InvalidTransitionError, type OrderAction } from "@/domain/orders/state-machine";
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

/**
 * The single path for changing an order's status — staff actions and the demo
 * simulator alike. The state machine is checked here first (clear errors, and
 * the courier/channel write-back need the next state), then the change is
 * applied by the database operation `apply_order_transition`, which re-checks
 * role, location and state under a row lock and records the history,
 * inventory consumption (first acceptance), domain event and audit entry in
 * the caller's transaction. Either all of it commits or none of it does.
 */
export async function transitionOrder(
  deps: TransitionDeps,
  orderId: string,
  action: OrderAction,
  opts: { reason?: string; at?: number } = {},
): Promise<TransitionResult> {
  const { repos, actor } = deps;
  const at = opts.at ?? Date.now();
  const order = await repos.orders.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (blockedByShortfall(order, action)) throw new ConflictError("Resolve the inventory shortfall on this order before continuing.");

  let next: UnifiedOrder;
  try {
    next = applyTransition(order, action, iso(at), { reason: opts.reason });
  } catch (err) {
    if (err instanceof InvalidTransitionError) throw new ConflictError(err.message);
    throw err;
  }

  // First acceptance assigns a courier (inventory is consumed by the database operation).
  let courier: UnifiedOrder["courier"] | undefined;
  if (!order.acceptedAt && next.acceptedAt) {
    const pick = () => RIDERS[Math.floor((deps.rng ?? Math.random)() * RIDERS.length)];
    if (next.courier?.provider === "platform" && next.courier.status === "unassigned") courier = { ...next.courier, status: "assigned", name: pick() };
    if (next.courier?.provider === "restaurant") courier = { ...next.courier, status: "assigned", name: "In-house driver" };
    if (courier) next.courier = courier;
  }

  // Write back to the originating channel (mock adapters in v0.2).
  const result = await deps.channels.adapters[order.channel].updateOrderStatus(next, next.status);

  await repos.orders.transition(order.id, action, {
    reason: opts.reason,
    syncStatus: result.ok ? "synced" : "failed",
    courier,
    actorLabel: actor.kind === "system" ? actor.label : undefined,
    channelSync: { ok: result.ok, externalStatus: result.externalStatus },
  });
  await deps.channels.backend.flush(repos, deps.mode);

  const saved = await repos.orders.findById(order.id);
  if (!saved) throw new NotFoundError("Order");
  return { order: saved, sync: { ok: result.ok, externalStatus: result.externalStatus, error: result.error } };
}
