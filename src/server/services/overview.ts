import "server-only";
import { compare, hourlyBuckets, prepMinutes, summarize } from "@/domain/analytics/metrics";
import { ORDER_CHANNELS, type OrderChannel } from "@/domain/channels/types";
import type { LocationScope } from "@/domain/locations/types";
import { computeSla } from "@/domain/orders/sla";
import { ACTIVE_STATUSES, netSales, type OrderStatus } from "@/domain/orders/types";
import { HOUR, toMs } from "@/lib/time";
import { listAlerts } from "./alerts";
import { channelHealthSummary } from "./channels";
import { live, ordersBetween, todayWindow } from "./context";

export async function getOverview(scope: LocationScope) {
  const rt = await live();
  const now = Date.now();
  const { db } = rt;
  const { start, yStart, yEnd } = todayWindow(now);
  const today = ordersBetween(rt, scope, start, now + 1);
  const yesterday = ordersBetween(rt, scope, yStart, yEnd);
  const t = summarize(today);
  const y = summarize(yesterday);

  const active = db.orders.filter(
    (o) => ACTIVE_STATUSES.includes(o.status) && (scope === "all" || o.locationId === scope),
  );
  const pipeline: Record<OrderStatus | "delayed", number> = {
    new: 0, accepted: 0, preparing: 0, ready: 0, picked_up: 0, completed: 0, cancelled: 0, delayed: 0,
  };
  for (const o of active) {
    pipeline[o.status] += 1;
    if (computeSla(o, now, db.settings.sla).level === "critical") pipeline.delayed += 1;
  }
  pipeline.cancelled = t.cancelledOrders;
  pipeline.picked_up = today.filter((o) => o.status === "picked_up").length;
  pipeline.completed = today.filter((o) => o.status === "completed").length;

  const revenueByChannel = ORDER_CHANNELS.map((channel) => {
    const list = today.filter((o) => o.channel === channel);
    const s = summarize(list);
    const ys = summarize(yesterday.filter((o) => o.channel === channel));
    return { channel, revenue: s.revenue, orders: s.fulfilledOrders, deltaPct: compare(s.revenue, ys.revenue).deltaPct };
  }).filter((r) => r.orders > 0 || db.channelConnections.some((c) => c.channel === r.channel));
  const total = revenueByChannel.reduce((s, r) => s + r.revenue, 0);

  const alerts = listAlerts(rt, scope, now);
  const locations = db.locations
    .filter((l) => scope === "all" || l.id === scope)
    .map((l) => {
      const lt = summarize(today.filter((o) => o.locationId === l.id));
      const la = active.filter((o) => o.locationId === l.id);
      const inKitchen = la.filter((o) => o.status === "accepted" || o.status === "preparing").length;
      const recentReady = today.filter((o) => o.locationId === l.id && (toMs(o.readyAt) ?? 0) > now - HOUR);
      const recentPrep = recentReady.map(prepMinutes).filter((v): v is number => v !== undefined);
      return {
        id: l.id,
        name: l.name,
        activeOrders: la.length,
        revenue: lt.revenue,
        orders: lt.orders,
        avgPrepMinutes: lt.avgPrepMinutes,
        lastHourPrepMinutes: recentPrep.length ? recentPrep.reduce((s, v) => s + v, 0) / recentPrep.length : null,
        kitchenLoadPct: Math.round((inKitchen / l.kitchenCapacity) * 100),
        delayed: la.filter((o) => computeSla(o, now, db.settings.sla).level === "critical").length,
        alerts: alerts.filter((a) => a.locationId === l.id).length,
        criticalAlerts: alerts.filter((a) => a.locationId === l.id && a.severity === "critical").length,
      };
    });

  const hourlyToday = hourlyBuckets(today, start, now + 1);
  const hourlyYesterday = hourlyBuckets(yesterday, yStart, yStart + (now + 1 - start));
  const trend = hourlyToday.map((b, i) => ({ ...b, previousRevenue: hourlyYesterday[i]?.revenue ?? 0 }));
  const firstActive = trend.findIndex((b) => b.revenue > 0 || (b.previousRevenue ?? 0) > 0);

  return {
    generatedAt: new Date(now).toISOString(),
    kpis: {
      revenue: compare(t.revenue, y.revenue),
      orders: compare(t.orders, y.orders),
      aov: compare(t.aov, y.aov),
      activeOrders: compare(active.length, null),
      avgPrepMinutes: compare(t.avgPrepMinutes, y.avgPrepMinutes),
      cancellationRate: compare(t.cancellationRate, y.cancellationRate),
    },
    pipeline,
    revenueByChannel: revenueByChannel.map((r) => ({ ...r, share: total ? (r.revenue / total) * 100 : 0 })),
    channelHealth: channelHealthSummary(rt, scope, today),
    locations,
    alerts: alerts.slice(0, 8),
    alertCount: alerts.length,
    trend: firstActive > 0 ? trend.slice(firstActive) : trend,
    recentOrders: [...today]
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
      .slice(0, 6)
      .map((o) => ({ id: o.id, orderNumber: o.orderNumber, channel: o.channel as OrderChannel, locationId: o.locationId, status: o.status, total: o.total, net: netSales(o), placedAt: o.placedAt })),
  };
}
export type OverviewData = Awaited<ReturnType<typeof getOverview>>;
