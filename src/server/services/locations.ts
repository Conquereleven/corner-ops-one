import "server-only";
import { z } from "zod";
import { prepMinutes, summarize } from "@/domain/analytics/metrics";
import { stockStatus } from "@/domain/inventory/types";
import { computeSla } from "@/domain/orders/sla";
import { DAY, HOUR, toMs } from "@/lib/time";
import { requireLocationAccess, requirePermission, type AppContext } from "../context/app-context";
import { listAlerts } from "./alerts";
import { todayWindow } from "./windows";

export async function getLocations(ctx: AppContext) {
  requirePermission(ctx, "locations.view");
  const now = ctx.now;
  const { start, yStart, yEnd } = todayWindow(now);
  const [today, yesterday, week, active, inventory, connections, settings, alerts] = await Promise.all([
    ctx.data.orders({ from: start, to: now + 1 }),
    ctx.data.orders({ from: yStart, to: yEnd }),
    ctx.data.orders({ from: start - 7 * DAY, to: start }),
    ctx.data.activeOrders(),
    ctx.data.inventory(),
    ctx.data.connections(),
    ctx.data.settings(),
    listAlerts(ctx),
  ]);
  return ctx.allowedLocations
    .filter((l) => ctx.scope.locationIds.includes(l.id))
    .map((l) => {
      const lToday = today.filter((o) => o.locationId === l.id);
      const t = summarize(lToday);
      const y = summarize(yesterday.filter((o) => o.locationId === l.id));
      const w = summarize(week.filter((o) => o.locationId === l.id));
      const la = active.filter((o) => o.locationId === l.id);
      const inKitchen = la.filter((o) => o.status === "accepted" || o.status === "preparing").length;
      const lastHour = lToday.filter((o) => (toMs(o.readyAt) ?? 0) > now - HOUR).map(prepMinutes).filter((v): v is number => v !== undefined);
      const inv = inventory.filter((i) => i.locationId === l.id).map(stockStatus);
      const locAlerts = alerts.filter((a) => a.locationId === l.id);
      const delayed = la.filter((o) => computeSla(o, now, settings.sla).level === "critical").length;
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
        baselinePrepMinutes: w.avgPrepMinutes,
        lastHourPrepMinutes: lastHour.length ? lastHour.reduce((s, v) => s + v, 0) / lastHour.length : null,
        cancellationRate: t.cancellationRate,
        activeOrders: la.length,
        delayedOrders: delayed,
        kitchenLoadPct: Math.round((inKitchen / l.kitchenCapacity) * 100),
        connections: connections.filter((c) => c.locationId === l.id).map((c) => ({ channel: c.channel, status: c.status })),
        inventoryAlerts: { low: inv.filter((s) => s === "low").length, critical: inv.filter((s) => s === "critical").length, out: inv.filter((s) => s === "out").length },
        alerts: locAlerts.slice(0, 4),
        alertCount: locAlerts.length,
      };
    });
}
export type LocationsData = Awaited<ReturnType<typeof getLocations>>;

/** Lightweight list for selectors: only locations the user may access. */
export async function getLocationDirectory(ctx: AppContext) {
  return ctx.allowedLocations.map((l) => ({ id: l.id, name: l.name, code: l.code }));
}
export type LocationDirectory = Awaited<ReturnType<typeof getLocationDirectory>>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const locationPatchSchema = z
  .object({
    operatingHours: z.object({ open: hhmm, close: hhmm }),
    managerName: z.string().trim().min(1).max(80),
    isOpen: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function updateLocation(ctx: AppContext, id: string, patch: z.infer<typeof locationPatchSchema>) {
  requirePermission(ctx, "locations.manage");
  requireLocationAccess(ctx, id);
  const after = await ctx.repos.locations.update(id, patch);
  // Audited by the database trigger on locations (before/after of changed columns).
  await ctx.repos.events.append({ type: "location.updated", aggregateType: "location", aggregateId: id, locationId: id, payload: { name: after.name, changes: patch } }, ctx.actor);
  return after;
}

export const createLocationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, "2–6 letters or digits"),
  area: z.string().trim().max(80).default(""),
  address: z.string().trim().max(200).default(""),
  operatingHours: z.object({ open: hhmm, close: hhmm }).default({ open: "11:00", close: "23:00" }),
  kitchenCapacity: z.number().int().min(1).max(200).default(10),
  managerName: z.string().trim().max(80).default(""),
});

export async function createLocation(ctx: AppContext, input: z.infer<typeof createLocationSchema>) {
  requirePermission(ctx, "locations.manage");
  if (!["OWNER", "ADMIN"].includes(ctx.membership.role)) requirePermission(ctx, "organization.manage");
  const restaurant = await ctx.repos.organization.restaurant();
  const location = await ctx.repos.locations.create({ ...input, restaurantId: restaurant.id });
  await ctx.repos.events.append({ type: "location.updated", aggregateType: "location", aggregateId: location.id, locationId: location.id, payload: { created: true, name: location.name } }, ctx.actor);
  return location;
}
