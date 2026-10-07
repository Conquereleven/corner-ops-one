import "server-only";
import { prepMinutes, summarize } from "@/domain/analytics/metrics";
import { stockStatus } from "@/domain/inventory/types";
import { computeSla } from "@/domain/orders/sla";
import { ACTIVE_STATUSES } from "@/domain/orders/types";
import { DAY, HOUR, toMs } from "@/lib/time";
import { listAlerts } from "./alerts";
import { live, ordersBetween, todayWindow } from "./context";

export async function getLocations() {
  const rt = await live();
  const now = Date.now();
  const { db } = rt;
  const { start, yStart, yEnd } = todayWindow(now);
  const alerts = listAlerts(rt, "all", now);
  return db.locations.map((l) => {
    const today = ordersBetween(rt, l.id, start, now + 1);
    const t = summarize(today);
    const y = summarize(ordersBetween(rt, l.id, yStart, yEnd));
    const week = summarize(ordersBetween(rt, l.id, start - 7 * DAY, start));
    const active = db.orders.filter((o) => o.locationId === l.id && ACTIVE_STATUSES.includes(o.status));
    const inKitchen = active.filter((o) => o.status === "accepted" || o.status === "preparing").length;
    const lastHour = today.filter((o) => (toMs(o.readyAt) ?? 0) > now - HOUR).map(prepMinutes).filter((v): v is number => v !== undefined);
    const inventory = db.inventoryItems.filter((i) => i.locationId === l.id);
    const invStatus = inventory.map(stockStatus);
    const connections = db.channelConnections.filter((c) => c.locationId === l.id);
    const locAlerts = alerts.filter((a) => a.locationId === l.id);
    const delayed = active.filter((o) => computeSla(o, now, db.settings.sla).level === "critical").length;
    const status: "operational" | "busy" | "attention" =
      locAlerts.some((a) => a.severity === "critical") || delayed >= 2 ? "attention" : inKitchen / l.kitchenCapacity > 0.7 ? "busy" : "operational";
    return {
      ...l,
      status,
      ordersToday: t.orders,
      revenueToday: t.revenue,
      revenueDeltaPct: y.revenue ? ((t.revenue - y.revenue) / y.revenue) * 100 : null,
      aov: t.aov,
      avgPrepMinutes: t.avgPrepMinutes,
      baselinePrepMinutes: week.avgPrepMinutes,
      lastHourPrepMinutes: lastHour.length ? lastHour.reduce((s, v) => s + v, 0) / lastHour.length : null,
      cancellationRate: t.cancellationRate,
      activeOrders: active.length,
      delayedOrders: delayed,
      kitchenLoadPct: Math.round((inKitchen / l.kitchenCapacity) * 100),
      connections: connections.map((c) => ({ channel: c.channel, status: c.status })),
      inventoryAlerts: {
        low: invStatus.filter((s) => s === "low").length,
        critical: invStatus.filter((s) => s === "critical").length,
        out: invStatus.filter((s) => s === "out").length,
      },
      alerts: locAlerts.slice(0, 4),
      alertCount: locAlerts.length,
    };
  });
}
export type LocationsData = Awaited<ReturnType<typeof getLocations>>;

/** Lightweight location list for selectors and name lookups. */
export async function getLocationDirectory() {
  const rt = await live();
  return rt.db.locations.map((l) => ({ id: l.id, name: l.name, code: l.code }));
}
export type LocationDirectory = Awaited<ReturnType<typeof getLocationDirectory>>;
