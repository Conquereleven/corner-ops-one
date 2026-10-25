import "server-only";
import { computeSla } from "@/domain/orders/sla";
import { MINUTE, toMs } from "@/lib/time";
import { appMode } from "../config";
import type { AppContext } from "../context/app-context";
import { getDemoFeed } from "../demo/simulation";
import { listAlerts } from "./alerts";
import { channelHealthSummary } from "./channel-health";
import { todayWindow } from "./windows";

/** Small, frequently polled payload powering the top bar (status, notifications, new-order toasts). */
export async function getSystemStatus(ctx: AppContext) {
  const now = ctx.now;
  const { start } = todayWindow(now);
  const canSeeOps = ctx.permissions.has("alerts.view");
  const [today, active, connections, settings, alerts, events] = await Promise.all([
    ctx.data.orders({ from: start, to: now + 1 }),
    ctx.data.activeOrders(),
    ctx.permissions.has("channels.view") ? ctx.data.connections() : Promise.resolve([]),
    ctx.data.settings(),
    canSeeOps ? listAlerts(ctx) : Promise.resolve([]),
    ctx.organization.isDemo && appMode() === "demo" ? getDemoFeed(ctx.organization.id, 8, ctx.db) : Promise.resolve([]),
  ]);
  const health = channelHealthSummary(connections, today).filter((h) => h.covered);
  const latest = today
    .filter((o) => o.source !== "seed" && (toMs(o.createdAt) ?? 0) > now - 5 * MINUTE)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-5)
    .map((o) => ({ id: o.id, orderNumber: o.orderNumber, channel: o.channel, locationId: o.locationId, total: o.total, createdAt: o.createdAt }));
  return {
    activeOrders: active.length,
    newOrders: active.filter((o) => o.status === "new").length,
    delayedOrders: active.filter((o) => computeSla(o, now, settings.sla).level === "critical").length,
    serverTime: new Date(now).toISOString(),
    isDemo: ctx.organization.isDemo,
    demo: settings.demo,
    channels: health,
    overall: health.some((h) => h.status === "disconnected") ? "outage" : health.some((h) => h.status === "degraded") ? "degraded" : "operational",
    alerts: alerts.slice(0, 12),
    alertCount: alerts.length,
    criticalCount: alerts.filter((a) => a.severity === "critical").length,
    latestOrders: latest,
    events,
  };
}
export type SystemStatusData = Awaited<ReturnType<typeof getSystemStatus>>;
