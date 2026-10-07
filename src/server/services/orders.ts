import "server-only";
import { z } from "zod";
import type { LocationScope } from "@/domain/locations/types";
import { computeSla } from "@/domain/orders/sla";
import { orderActionSchema, InvalidTransitionError } from "@/domain/orders/state-machine";
import { ACTIVE_STATUSES, type OrderFilters, type OrderStatus, type UnifiedOrder } from "@/domain/orders/types";
import { DAY, HOUR, toMs } from "@/lib/time";
import { emitSimulatedOrder, ingest } from "../simulation/engine";
import { ConflictError, DEMO_USER_ID, inScope, live, NotFoundError, todayWindow } from "./context";
import { transitionOrder } from "./order-transitions";
import type { OrderChannel } from "@/domain/channels/types";

export async function listOrders(scope: LocationScope, filters: OrderFilters) {
  const rt = await live();
  const now = Date.now();
  const { db } = rt;
  const { start, yStart } = todayWindow(now);
  const range = filters.range ?? "live";
  const q = filters.q?.trim().toLowerCase();

  const inRange = (o: UnifiedOrder) => {
    const t = toMs(o.placedAt)!;
    switch (range) {
      case "live":
        return ACTIVE_STATUSES.includes(o.status) || o.status === "picked_up" || t >= now - 2 * HOUR || (toMs(o.updatedAt) ?? 0) >= now - HOUR;
      case "today":
        return t >= start;
      case "yesterday":
        return t >= yStart && t < start;
      case "7d":
        return t >= start - 6 * DAY;
    }
  };

  const base = db.orders.filter((o) => inScope(scope, o.locationId) && inRange(o));
  const matches = (o: UnifiedOrder) => {
    if (filters.location && filters.location !== "all" && o.locationId !== filters.location) return false;
    if (filters.channel && o.channel !== filters.channel) return false;
    if (q) {
      const hay = [o.orderNumber, o.externalOrderId, o.customer?.name, o.customer?.phone, ...o.items.map((i) => i.name)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.delayed && !(ACTIVE_STATUSES.includes(o.status) && computeSla(o, now, db.settings.sla).level === "critical")) return false;
    return true;
  };
  const filtered = base.filter(matches);

  const counts: Record<OrderStatus | "active" | "all" | "delayed", number> = {
    all: filtered.length, active: 0, delayed: 0,
    new: 0, accepted: 0, preparing: 0, ready: 0, picked_up: 0, completed: 0, cancelled: 0,
  };
  for (const o of filtered) {
    counts[o.status] += 1;
    if (ACTIVE_STATUSES.includes(o.status)) {
      counts.active += 1;
      if (computeSla(o, now, db.settings.sla).level === "critical") counts.delayed += 1;
    }
  }

  const status = filters.status ?? "all";
  const orders = filtered
    .filter((o) => status === "all" || (status === "active" ? ACTIVE_STATUSES.includes(o.status) : o.status === status))
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    .slice(0, filters.limit ?? 150);

  return { orders, counts, sla: db.settings.sla, serverTime: new Date(now).toISOString() };
}
export type OrdersData = Awaited<ReturnType<typeof listOrders>>;

export async function getOrder(id: string) {
  const rt = await live();
  const order = rt.db.ordersById.get(id) ?? rt.db.orders.find((o) => o.orderNumber === id);
  if (!order) throw new NotFoundError("Order");
  const customer = order.customer?.id ? rt.db.customers.find((c) => c.id === order.customer!.id) : undefined;
  const customerOrders = customer ? rt.db.orders.filter((o) => o.customer?.id === customer.id).length : 0;
  const logs = rt.db.channelLogs
    .filter((l) => l.message.includes(order.externalOrderId))
    .slice(-10)
    .reverse();
  return {
    order,
    customer: customer ? { ...customer, lifetimeOrders: customerOrders } : null,
    channelLogs: logs,
    sla: rt.db.settings.sla,
  };
}
export type OrderDetailData = Awaited<ReturnType<typeof getOrder>>;

export const orderActionInputSchema = z.object({
  action: orderActionSchema,
  reason: z.string().max(200).optional(),
});

export async function performOrderAction(id: string, input: z.infer<typeof orderActionInputSchema>) {
  const rt = await live();
  const order = rt.db.ordersById.get(id);
  if (!order) throw new NotFoundError("Order");
  try {
    return await transitionOrder(rt, order, input.action, { type: "user", userId: DEMO_USER_ID }, { reason: input.reason });
  } catch (err) {
    if (err instanceof InvalidTransitionError) throw new ConflictError(err.message);
    throw err;
  }
}

/** Presenter tool: a customer places an order on a simulated platform, which is ingested immediately. */
export async function injectDemoOrder(channel: OrderChannel | undefined, locationId: string | undefined) {
  const rt = await live();
  const now = Date.now();
  const emitted = emitSimulatedOrder(rt, now, { channel, locationId });
  if (!emitted) throw new ConflictError(`${channel ?? "Channel"} is not available at that location.`);
  const created = await ingest(rt, now);
  const order = created.find((o) => o.channel === emitted.channel && o.locationId === emitted.locationId);
  if (!order) {
    return { order: null, queued: true, message: "The integration is disconnected — the order is queued on the platform until you reconnect." };
  }
  order.metadata = { ...order.metadata, demoHold: true };
  return { order, queued: false, message: null };
}
