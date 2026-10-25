import "server-only";
import { computeAlerts } from "@/domain/alerts/engine";
import type { OperationalAlert } from "@/domain/alerts/types";
import { usageRates } from "@/domain/inventory/forecast";
import { DAY, HOUR, iso } from "@/lib/time";
import type { AppContext } from "../context/app-context";
import { todayWindow } from "./windows";

/** Operational alerts derived from live state, with persisted first-seen and acknowledgement. */
export async function listAlerts(ctx: AppContext): Promise<OperationalAlert[]> {
  const now = ctx.now;
  const { start } = todayWindow(now);
  const [today, baseline, recent, inventory, menu, connections, settings, states, active] = await Promise.all([
    ctx.data.orders({ from: start, to: now + 1 }),
    ctx.data.orders({ from: start - 7 * DAY, to: start }),
    ctx.data.orders({ from: now - 4 * HOUR, to: now + 1, withItems: true }),
    ctx.data.inventory(),
    ctx.data.menu(),
    ctx.data.connections(),
    ctx.data.settings(),
    ctx.repos.alerts.states(),
    ctx.data.activeOrders(),
  ]);
  const drafts = computeAlerts({
    organizationId: ctx.organization.id,
    now,
    locations: ctx.allowedLocations.filter((l) => ctx.scope.locationIds.includes(l.id)),
    ordersToday: today,
    ordersBaseline: baseline,
    inventory,
    usageRates: usageRates(recent, menu.items, now),
    menuItems: menu.items,
    connections,
    mappings: menu.mappings,
    sla: settings.sla,
    shortfallOrders: active.filter((o) => o.inventoryShortfall === "open" && ctx.scope.locationIds.includes(o.locationId)),
  });
  const unseen = drafts.filter((d) => !states.has(d.id));
  if (unseen.length) {
    await ctx.repos.alerts.recordSeen(
      unseen.map((d) => ({ key: d.id, locationId: d.locationId, channel: d.channel, severity: d.severity, category: d.category, title: d.title, detail: d.detail, href: d.href })),
    );
  }
  return drafts
    .filter((d) => !states.get(d.id)?.acknowledgedAt)
    .map((d) => ({ ...d, createdAt: states.get(d.id)?.createdAt ?? iso(now) }));
}

export async function acknowledgeAlert(ctx: AppContext, key: string) {
  const ok = await ctx.repos.alerts.acknowledge(key, ctx.user.id);
  return { ok };
}
