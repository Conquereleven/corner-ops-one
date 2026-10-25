import "server-only";
import { z } from "zod";
import { computeSla } from "@/domain/orders/sla";
import { orderActionSchema } from "@/domain/orders/state-machine";
import { ACTIVE_STATUSES, type OrderFilters, type OrderStatus, type UnifiedOrder } from "@/domain/orders/types";
import { DAY, HOUR, toMs } from "@/lib/time";
import { requireLocationAccess, requirePermission, type AppContext } from "../context/app-context";
import { loadChannelRuntime } from "../demo/backend-session";
import { ConflictError, NotFoundError } from "../errors";
import { transitionOrder } from "./order-transitions";
import { todayWindow } from "./windows";

export async function listOrders(ctx: AppContext, filters: OrderFilters) {
  const now = ctx.now;
  const { start, yStart } = todayWindow(now);
  const range = filters.range ?? "live";
  const q = filters.q?.trim().toLowerCase();
  const settings = await ctx.data.settings();

  if (filters.location && filters.location !== "all") requireLocationAccess(ctx, filters.location);

  const window =
    range === "today" ? { from: start, to: now + 1 }
    : range === "yesterday" ? { from: yStart, to: start }
    : range === "7d" ? { from: start - 6 * DAY, to: now + 1 }
    : { from: now - 6 * HOUR, to: now + 1 };
  const [placed, active] = await Promise.all([
    ctx.data.orders({ ...window, withItems: true }),
    range === "live" ? ctx.data.activeOrders() : Promise.resolve([] as UnifiedOrder[]),
  ]);

  const byId = new Map<string, UnifiedOrder>();
  for (const o of [...placed, ...active]) byId.set(o.id, o);
  const base = [...byId.values()].filter((o) => {
    if (range !== "live") return true;
    const t = toMs(o.placedAt)!;
    return ACTIVE_STATUSES.includes(o.status) || o.status === "picked_up" || t >= now - 2 * HOUR || (toMs(o.updatedAt) ?? 0) >= now - HOUR;
  });

  const matches = (o: UnifiedOrder) => {
    if (filters.location && filters.location !== "all" && o.locationId !== filters.location) return false;
    if (filters.channel && o.channel !== filters.channel) return false;
    if (q) {
      const hay = [o.orderNumber, o.externalOrderId, o.customer?.name, o.customer?.phone, ...o.items.map((i) => i.name)].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filters.delayed && !(ACTIVE_STATUSES.includes(o.status) && computeSla(o, now, settings.sla).level === "critical")) return false;
    return true;
  };
  const filtered = base.filter(matches);

  const counts: Record<OrderStatus | "active" | "all" | "delayed", number> = {
    all: filtered.length, active: 0, delayed: 0, new: 0, accepted: 0, preparing: 0, ready: 0, picked_up: 0, completed: 0, cancelled: 0,
  };
  for (const o of filtered) {
    counts[o.status] += 1;
    if (ACTIVE_STATUSES.includes(o.status)) {
      counts.active += 1;
      if (computeSla(o, now, settings.sla).level === "critical") counts.delayed += 1;
    }
  }

  const status = filters.status ?? "all";
  const orders = filtered
    .filter((o) => status === "all" || (status === "active" ? ACTIVE_STATUSES.includes(o.status) : o.status === status))
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    .slice(0, filters.limit ?? 150);

  return { orders, counts, sla: settings.sla, serverTime: new Date(now).toISOString() };
}
export type OrdersData = Awaited<ReturnType<typeof listOrders>>;

export async function getOrder(ctx: AppContext, id: string) {
  const order = (await ctx.repos.orders.findById(id)) ?? (await ctx.repos.orders.findByOrderNumber(id));
  if (!order) throw new NotFoundError("Order");
  requireLocationAccess(ctx, order.locationId);
  const [customer, settings, logs] = await Promise.all([
    order.customer?.id ? ctx.repos.customers.findById(order.customer.id) : Promise.resolve(null),
    ctx.data.settings(),
    ctx.repos.channels.logs({ channel: order.channel, locationIds: [order.locationId], limit: 10, matching: order.externalOrderId }),
  ]);
  const [lifetimeOrders, shortfalls] = await Promise.all([
    customer ? ctx.repos.orders.countForCustomer(customer.id) : Promise.resolve(0),
    order.inventoryShortfall ? ctx.repos.orders.shortfalls(order.id) : Promise.resolve([]),
  ]);
  return {
    order,
    shortfalls,
    canResolveShortfall: ctx.permissions.has("inventory.manage"),
    customer: customer ? { ...customer, lifetimeOrders } : null,
    channelLogs: logs,
    sla: settings.sla,
  };
}
export type OrderDetailData = Awaited<ReturnType<typeof getOrder>>;

export const orderActionInputSchema = z.object({
  action: orderActionSchema,
  reason: z.string().trim().max(200).optional(),
});

export async function performOrderAction(ctx: AppContext, id: string, input: z.infer<typeof orderActionInputSchema>) {
  requirePermission(ctx, input.action === "cancel" ? "orders.cancel" : "orders.progress");
  const existing = await ctx.repos.orders.findById(id);
  if (!existing) throw new NotFoundError("Order");
  requireLocationAccess(ctx, existing.locationId);
  const channels = await loadChannelRuntime(ctx.repos, { locationIds: [existing.locationId] });
  return transitionOrder({ repos: ctx.repos, actor: ctx.actor, channels, mode: "user" }, id, input.action, { reason: input.reason, at: Date.now() });
}

export const shortfallResolutionSchema = z.object({
  method: z.enum(["reconcile_from_stock", "accept_shortfall"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * Explicit, audited resolution of an order's inventory shortfall (never automatic):
 * - reconcile_from_stock deducts stock that is available now for the unmet quantity
 *   (lines that still cannot be met stay open);
 * - accept_shortfall closes the lines without stock changes (substitution, omitted
 *   ingredient, comp) and requires a note.
 * The database operation re-checks role and location and writes event + audit.
 */
export async function resolveOrderShortfall(ctx: AppContext, id: string, input: z.infer<typeof shortfallResolutionSchema>) {
  requirePermission(ctx, "inventory.manage");
  const order = await ctx.repos.orders.findById(id);
  if (!order) throw new NotFoundError("Order");
  requireLocationAccess(ctx, order.locationId);
  if (input.method === "accept_shortfall" && !input.note) throw new ConflictError("Add a note explaining how the shortfall was handled.");
  const result = await ctx.repos.orders.resolveShortfall(order.id, input.method, input.note || undefined);
  return { ...result, order: (await ctx.repos.orders.findById(order.id))!, shortfalls: await ctx.repos.orders.shortfalls(order.id) };
}
