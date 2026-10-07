import "server-only";
import { computeAlerts } from "@/domain/alerts/engine";
import type { OperationalAlert } from "@/domain/alerts/types";
import { usageRates } from "@/domain/inventory/forecast";
import type { LocationScope } from "@/domain/locations/types";
import { DAY, iso } from "@/lib/time";
import type { Runtime } from "../store/runtime";
import { inScope, ordersBetween, todayWindow } from "./context";

export function listAlerts(rt: Runtime, scope: LocationScope, now = Date.now()): OperationalAlert[] {
  const { db } = rt;
  const { start } = todayWindow(now);
  const ordersToday = ordersBetween(rt, "all", start, now + 1);
  const drafts = computeAlerts({
    organizationId: db.organization.id,
    now,
    locations: db.locations,
    ordersToday,
    ordersBaseline: ordersBetween(rt, "all", start - 7 * DAY, start),
    inventory: db.inventoryItems,
    usageRates: usageRates(ordersBetween(rt, "all", now - 4 * 3600_000, now + 1), db.menuItems, now),
    menuItems: db.menuItems,
    connections: db.channelConnections,
    mappings: db.menuMappings,
    sla: db.settings.sla,
  });
  return drafts
    .filter((a) => !a.locationId || inScope(scope, a.locationId))
    .filter((a) => !db.acknowledgedAlerts.has(a.id))
    .map((a) => {
      if (!db.alertFirstSeen.has(a.id)) db.alertFirstSeen.set(a.id, iso(now));
      return { ...a, createdAt: db.alertFirstSeen.get(a.id)! };
    });
}

export function acknowledgeAlert(rt: Runtime, id: string) {
  rt.db.acknowledgedAlerts.add(id);
}
