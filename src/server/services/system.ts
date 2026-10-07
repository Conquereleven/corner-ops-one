import "server-only";
import type { LocationScope } from "@/domain/locations/types";
import { computeSla } from "@/domain/orders/sla";
import { ACTIVE_STATUSES } from "@/domain/orders/types";
import { toMs } from "@/lib/time";
import { listAlerts } from "./alerts";
import { channelHealthSummary } from "./channels";
import { live, ordersBetween, todayWindow } from "./context";

/** Small, frequently polled payload powering the top bar (status, notifications, new-order toasts). */
export async function getSystemStatus(scope: LocationScope) {
  const rt = await live();
  const now = Date.now();
  const { db } = rt;
  const { start } = todayWindow(now);
  const today = ordersBetween(rt, scope, start, now + 1);
  const health = channelHealthSummary(rt, scope, today).filter((h) => h.covered);
  const alerts = listAlerts(rt, scope, now);
  const latest = db.orders
    .filter((o) => (scope === "all" || o.locationId === scope) && o.source !== "seed" && (toMs(o.createdAt) ?? 0) > now - 5 * 60_000)
    .slice(-5)
    .map((o) => ({ id: o.id, orderNumber: o.orderNumber, channel: o.channel, locationId: o.locationId, total: o.total, createdAt: o.createdAt }));
  const active = db.orders.filter((o) => (scope === "all" || o.locationId === scope) && ACTIVE_STATUSES.includes(o.status));
  return {
    activeOrders: active.length,
    newOrders: active.filter((o) => o.status === "new").length,
    delayedOrders: active.filter((o) => computeSla(o, now, db.settings.sla).level === "critical").length,
    serverTime: new Date(now).toISOString(),
    demo: db.settings.demo,
    channels: health,
    overall: health.some((h) => h.status === "disconnected")
      ? "outage"
      : health.some((h) => h.status === "degraded")
        ? "degraded"
        : "operational",
    alerts: alerts.slice(0, 12),
    alertCount: alerts.length,
    criticalCount: alerts.filter((a) => a.severity === "critical").length,
    latestOrders: latest,
    events: db.simulation.events.slice(-8).reverse(),
  };
}
export type SystemStatusData = Awaited<ReturnType<typeof getSystemStatus>>;
