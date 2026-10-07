import "server-only";
import { prepMinutes } from "@/domain/analytics/metrics";
import type { LocationScope } from "@/domain/locations/types";
import { computeSla } from "@/domain/orders/sla";
import { HOUR, MINUTE, toMs } from "@/lib/time";
import { inScope, live } from "./context";

export async function getKitchenBoard(scope: LocationScope) {
  const rt = await live();
  const now = Date.now();
  const { db } = rt;
  const tickets = db.orders
    .filter((o) => inScope(scope, o.locationId) && ["new", "accepted", "preparing", "ready"].includes(o.status))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const recentlyBumped = db.orders
    .filter(
      (o) =>
        inScope(scope, o.locationId) &&
        (o.status === "picked_up" || o.status === "completed") &&
        (toMs(o.pickedUpAt) ?? 0) > now - 10 * MINUTE,
    )
    .sort((a, b) => (b.pickedUpAt ?? "").localeCompare(a.pickedUpAt ?? ""))
    .slice(0, 8);
  const readyLastHour = db.orders.filter((o) => inScope(scope, o.locationId) && (toMs(o.readyAt) ?? 0) > now - HOUR);
  const preps = readyLastHour.map(prepMinutes).filter((v): v is number => v !== undefined);
  const levels = tickets.map((t) => computeSla(t, now, db.settings.sla).level);
  return {
    tickets,
    recentlyBumped,
    sla: db.settings.sla,
    stats: {
      inQueue: tickets.length,
      warning: levels.filter((l) => l === "warning").length,
      critical: levels.filter((l) => l === "critical").length,
      avgPrepLastHour: preps.length ? preps.reduce((s, v) => s + v, 0) / preps.length : null,
      completedLastHour: readyLastHour.length,
    },
    serverTime: new Date(now).toISOString(),
  };
}
export type KitchenData = Awaited<ReturnType<typeof getKitchenBoard>>;
