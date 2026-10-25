import "server-only";
import { prepMinutes } from "@/domain/analytics/metrics";
import { computeSla } from "@/domain/orders/sla";
import { HOUR, MINUTE, toMs } from "@/lib/time";
import type { AppContext } from "../context/app-context";

export async function getKitchenBoard(ctx: AppContext) {
  const now = ctx.now;
  const [active, recent, settings] = await Promise.all([
    ctx.data.activeOrders(),
    ctx.repos.orders.list({ locationIds: ctx.scope.locationIds, placedFrom: now - 6 * HOUR, placedTo: now + 1, withItems: false }),
    ctx.data.settings(),
  ]);
  const tickets = [...active].sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const recentlyBumped = recent
    .filter((o) => (o.status === "picked_up" || o.status === "completed") && (toMs(o.pickedUpAt) ?? 0) > now - 10 * MINUTE)
    .sort((a, b) => (b.pickedUpAt ?? "").localeCompare(a.pickedUpAt ?? ""))
    .slice(0, 8);
  const readyLastHour = recent.filter((o) => (toMs(o.readyAt) ?? 0) > now - HOUR);
  const preps = readyLastHour.map(prepMinutes).filter((v): v is number => v !== undefined);
  const levels = tickets.map((t) => computeSla(t, now, settings.sla).level);
  return {
    tickets,
    recentlyBumped,
    sla: settings.sla,
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
