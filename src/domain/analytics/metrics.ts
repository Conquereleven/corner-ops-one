import type { OrderChannel } from "../channels/types";
import type { MenuItem } from "../menu/types";
import type { UnifiedOrder } from "../orders/types";
import { netSales } from "../orders/types";
import { DUBAI_OFFSET_MS, HOUR, MINUTE, dubaiDateKey, dubaiHour, toMs } from "@/lib/time";
import { pctChange } from "@/lib/format";

export interface OrderSummary {
  orders: number;
  fulfilledOrders: number;
  cancelledOrders: number;
  revenue: number;
  grossSales: number;
  discounts: number;
  aov: number;
  cancellationRate: number;
  avgPrepMinutes: number | null;
}

/** Minutes from acceptance to ready — the kitchen's controllable time. */
export function prepMinutes(order: UnifiedOrder): number | undefined {
  const a = toMs(order.acceptedAt);
  const r = toMs(order.readyAt);
  if (a === undefined || r === undefined) return undefined;
  return (r - a) / MINUTE;
}

export function inWindow(order: UnifiedOrder, start: number, end: number): boolean {
  const t = toMs(order.placedAt)!;
  return t >= start && t < end;
}

export function summarize(orders: UnifiedOrder[]): OrderSummary {
  let revenue = 0;
  let gross = 0;
  let discounts = 0;
  let cancelled = 0;
  let prepSum = 0;
  let prepN = 0;
  for (const o of orders) {
    if (o.status === "cancelled") {
      cancelled += 1;
      continue;
    }
    revenue += netSales(o);
    gross += o.subtotal;
    discounts += o.discount;
    const p = prepMinutes(o);
    if (p !== undefined) {
      prepSum += p;
      prepN += 1;
    }
  }
  const fulfilled = orders.length - cancelled;
  return {
    orders: orders.length,
    fulfilledOrders: fulfilled,
    cancelledOrders: cancelled,
    revenue,
    grossSales: gross,
    discounts,
    aov: fulfilled ? revenue / fulfilled : 0,
    cancellationRate: orders.length ? (cancelled / orders.length) * 100 : 0,
    avgPrepMinutes: prepN ? prepSum / prepN : null,
  };
}

export interface MetricComparison {
  value: number | null;
  previous: number | null;
  deltaPct: number | null;
}

export function compare(value: number | null, previous: number | null): MetricComparison {
  return {
    value,
    previous,
    deltaPct: value === null || previous === null ? null : pctChange(value, previous),
  };
}

export function groupBy<K>(orders: UnifiedOrder[], key: (o: UnifiedOrder) => K): Map<K, UnifiedOrder[]> {
  const m = new Map<K, UnifiedOrder[]>();
  for (const o of orders) {
    const k = key(o);
    const arr = m.get(k);
    if (arr) arr.push(o);
    else m.set(k, [o]);
  }
  return m;
}

export interface TimeBucket {
  key: string;
  ts: number;
  revenue: number;
  orders: number;
  previousRevenue?: number;
  previousOrders?: number;
}

/** Hourly buckets within [start, end) — used for today / yesterday. */
export function hourlyBuckets(orders: UnifiedOrder[], start: number, end: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  for (let t = start; t < end; t += HOUR) {
    buckets.push({ key: `${dubaiHour(t).toString().padStart(2, "0")}:00`, ts: t, revenue: 0, orders: 0 });
  }
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const idx = Math.floor(((toMs(o.placedAt) ?? 0) - start) / HOUR);
    if (idx >= 0 && idx < buckets.length) {
      buckets[idx].revenue += netSales(o);
      buckets[idx].orders += 1;
    }
  }
  return buckets;
}

export function dailyBuckets(orders: UnifiedOrder[], start: number, end: number): TimeBucket[] {
  const buckets = new Map<string, TimeBucket>();
  for (let t = start; t < end; t += 24 * HOUR) {
    const key = dubaiDateKey(t);
    buckets.set(key, { key, ts: t, revenue: 0, orders: 0 });
  }
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const b = buckets.get(dubaiDateKey(toMs(o.placedAt)!));
    if (b) {
      b.revenue += netSales(o);
      b.orders += 1;
    }
  }
  return [...buckets.values()];
}

/** Average orders per hour-of-day across the window (Dubai time). */
export function hourOfDayProfile(orders: UnifiedOrder[], days: number) {
  const counts = new Array(24).fill(0) as number[];
  const revenue = new Array(24).fill(0) as number[];
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const h = new Date((toMs(o.placedAt) ?? 0) + DUBAI_OFFSET_MS).getUTCHours();
    counts[h] += 1;
    revenue[h] += netSales(o);
  }
  const d = Math.max(1, days);
  return counts.map((c, h) => ({ hour: h, orders: c / d, revenue: revenue[h] / d }));
}

export interface ProductPerformance {
  menuItemId: string;
  name: string;
  categoryId: string;
  quantity: number;
  revenue: number;
  orders: number;
  foodCost: number;
  marginPct: number;
}

export function productPerformance(orders: UnifiedOrder[], menu: MenuItem[]): ProductPerformance[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const perf = new Map<string, ProductPerformance>();
  for (const m of menu) {
    perf.set(m.id, { menuItemId: m.id, name: m.name, categoryId: m.categoryId, quantity: 0, revenue: 0, orders: 0, foodCost: 0, marginPct: 0 });
  }
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const discountRatio = o.subtotal ? (o.subtotal - o.discount) / o.subtotal : 1;
    for (const line of o.items) {
      if (!line.menuItemId) continue;
      const p = perf.get(line.menuItemId);
      const item = byId.get(line.menuItemId);
      if (!p || !item) continue;
      p.quantity += line.quantity;
      p.revenue += line.total * discountRatio;
      p.orders += 1;
      p.foodCost += item.foodCost * line.quantity;
    }
  }
  for (const p of perf.values()) p.marginPct = p.revenue ? ((p.revenue - p.foodCost) / p.revenue) * 100 : 0;
  return [...perf.values()];
}

export function channelTotals(orders: UnifiedOrder[]): Map<OrderChannel, OrderSummary> {
  const out = new Map<OrderChannel, OrderSummary>();
  for (const [ch, list] of groupBy(orders, (o) => o.channel)) out.set(ch, summarize(list));
  return out;
}
