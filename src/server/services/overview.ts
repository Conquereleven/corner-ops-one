import "server-only";
import { compare, hourlyBuckets, prepMinutes, summarize } from "@/domain/analytics/metrics";
import { ORDER_CHANNELS } from "@/domain/channels/types";
import { computeSla } from "@/domain/orders/sla";
import { netSales, type OrderStatus } from "@/domain/orders/types";
import { HOUR, toMs } from "@/lib/time";
import type { AppContext } from "../context/app-context";
import { listAlerts } from "./alerts";
import { channelHealthSummary } from "./channel-health";
import { todayWindow } from "./windows";

export async function getOverview(ctx: AppContext) {
  const now = ctx.now;
  const { start, yStart, yEnd } = todayWindow(now);
  const [today, yesterday, active, connections, settings, alerts] = await Promise.all([
    ctx.data.orders({ from: start, to: now + 1 }),
    ctx.data.orders({ from: yStart, to: yEnd }),
    ctx.data.activeOrders(),
    ctx.data.connections(),
    ctx.data.settings(),
    listAlerts(ctx),
  ]);
  const t = summarize(today);
  const y = summarize(yesterday);

  const pipeline: Record<OrderStatus | "delayed", number> = {
    new: 0, accepted: 0, preparing: 0, ready: 0, picked_up: 0, completed: 0, cancelled: 0, delayed: 0,
  };
  for (const o of active) {
    pipeline[o.status] += 1;
    if (computeSla(o, now, settings.sla).level === "critical") pipeline.delayed += 1;
  }
  pipeline.cancelled = t.cancelledOrders;
  pipeline.picked_up = today.filter((o) => o.status === "picked_up").length;
  pipeline.completed = today.filter((o) => o.status === "completed").length;

  const revenueByChannel = ORDER_CHANNELS.map((channel) => {
    const s = summarize(today.filter((o) => o.channel === channel));
    const ys = summarize(yesterday.filter((o) => o.channel === channel));
    return { channel, revenue: s.revenue, orders: s.fulfilledOrders, deltaPct: compare(s.revenue, ys.revenue).deltaPct };
  }).filter((r) => r.orders > 0 || connections.some((c) => c.channel === r.channel));
  const total = revenueByChannel.reduce((s, r) => s + r.revenue, 0);

  const locations = ctx.allowedLocations
    .filter((l) => ctx.scope.locationIds.includes(l.id))
    .map((l) => {
      const lt = summarize(today.filter((o) => o.locationId === l.id));
      const la = active.filter((o) => o.locationId === l.id);
      const inKitchen = la.filter((o) => o.status === "accepted" || o.status === "preparing").length;
      const recentPrep = today
        .filter((o) => o.locationId === l.id && (toMs(o.readyAt) ?? 0) > now - HOUR)
        .map(prepMinutes)
        .filter((v): v is number => v !== undefined);
      return {
        id: l.id,
        name: l.name,
        activeOrders: la.length,
        revenue: lt.revenue,
        orders: lt.orders,
        avgPrepMinutes: lt.avgPrepMinutes,
        lastHourPrepMinutes: recentPrep.length ? recentPrep.reduce((s, v) => s + v, 0) / recentPrep.length : null,
        kitchenLoadPct: Math.round((inKitchen / l.kitchenCapacity) * 100),
        delayed: la.filter((o) => computeSla(o, now, settings.sla).level === "critical").length,
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
    channelHealth: channelHealthSummary(connections, today),
    locations,
    alerts: alerts.slice(0, 8),
    alertCount: alerts.length,
    trend: firstActive > 0 ? trend.slice(firstActive) : trend,
    recentOrders: [...today]
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
      .slice(0, 6)
      .map((o) => ({ id: o.id, orderNumber: o.orderNumber, channel: o.channel, locationId: o.locationId, status: o.status, total: o.total, net: netSales(o), placedAt: o.placedAt })),
  };
}
export type OverviewData = Awaited<ReturnType<typeof getOverview>>;
