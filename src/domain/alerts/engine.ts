import { summarize } from "../analytics/metrics";
import type { ChannelConnection, OrderChannel } from "../channels/types";
import { channelName } from "../channels/types";
import { hoursUntilStockout } from "../inventory/forecast";
import type { InventoryItem } from "../inventory/types";
import { stockStatus } from "../inventory/types";
import type { Location } from "../locations/types";
import type { MenuChannelMapping, MenuItem } from "../menu/types";
import { computeSla, type SlaSettings } from "../orders/sla";
import type { UnifiedOrder } from "../orders/types";
import { ACTIVE_STATUSES } from "../orders/types";
import type { OperationalAlert } from "./types";
import { SEVERITY_RANK } from "./types";

export interface AlertInputs {
  organizationId: string;
  now: number;
  locations: Location[];
  ordersToday: UnifiedOrder[];
  /** Orders from the 7 days before today, for baselines. */
  ordersBaseline: UnifiedOrder[];
  inventory: InventoryItem[];
  usageRates: Map<string, number>;
  menuItems: MenuItem[];
  connections: ChannelConnection[];
  mappings: MenuChannelMapping[];
  sla: SlaSettings;
  /** Active orders whose recipe stock could not be fully consumed (unresolved shortfall). */
  shortfallOrders?: UnifiedOrder[];
}

type DraftAlert = Omit<OperationalAlert, "createdAt">;

function fmtQty(v: number, unit: string) {
  return `${unit === "pcs" || unit === "bunch" ? Math.round(v) : v.toFixed(1)} ${unit}`;
}

/** Derive operational alerts from current state. Ids are stable per condition. */
export function computeAlerts(input: AlertInputs): DraftAlert[] {
  const alerts: DraftAlert[] = [];
  const locName = (id: string) => input.locations.find((l) => l.id === id)?.name ?? id;
  const org = input.organizationId;

  // Inventory ----------------------------------------------------------------
  for (const item of input.inventory) {
    const status = stockStatus(item);
    if (status === "healthy") continue;
    const affected = input.menuItems.filter((m) => m.recipe.some((r) => r.inventoryItemKey === item.key));
    const names = affected.slice(0, 2).map((m) => m.name).join(", ");
    const more = affected.length > 2 ? ` +${affected.length - 2} more` : "";
    const hours = hoursUntilStockout(item, input.usageRates.get(`${item.locationId}:${item.key}`));
    const runout =
      status === "out" ? " Items using it are unavailable." : hours !== null && hours < 8 ? ` Est. run-out in ~${Math.max(1, Math.round(hours))}h at current pace.` : "";
    alerts.push({
      id: `inv:${item.id}:${status}`,
      organizationId: org,
      locationId: item.locationId,
      severity: status === "low" ? "warning" : "critical",
      category: "inventory",
      title: status === "out" ? `${item.name} out of stock` : `${item.name} ${status === "low" ? "below threshold" : "critically low"}`,
      detail: `${locName(item.locationId)}: ${fmtQty(item.quantity, item.unit)} left (threshold ${fmtQty(item.threshold, item.unit)}). Used in ${names || "no menu items"}${more}.${runout}`,
      href: `/inventory?item=${item.id}`,
    });
  }

  // Inventory shortfalls: fulfilment is blocked until a manager resolves them ---------
  for (const o of input.shortfallOrders ?? []) {
    alerts.push({
      id: `shortfall:${o.id}`,
      organizationId: org,
      locationId: o.locationId,
      channel: o.channel,
      severity: "critical",
      category: "inventory",
      title: `Stock shortfall on ${o.orderNumber}`,
      detail: `${locName(o.locationId)}: recipe stock ran short when the order was accepted. It can't be marked ready until a manager resolves the shortfall.`,
      href: `/orders/${o.id}`,
    });
  }

  // Kitchen: prep time drift & late orders -----------------------------------------
  for (const loc of input.locations) {
    const today = summarize(input.ordersToday.filter((o) => o.locationId === loc.id));
    const base = summarize(input.ordersBaseline.filter((o) => o.locationId === loc.id));
    if (today.avgPrepMinutes && base.avgPrepMinutes) {
      const drift = ((today.avgPrepMinutes - base.avgPrepMinutes) / base.avgPrepMinutes) * 100;
      if (drift >= 12) {
        alerts.push({
          id: `prep:${loc.id}`,
          organizationId: org,
          locationId: loc.id,
          severity: drift >= 25 ? "critical" : "warning",
          category: "kitchen",
          title: `${loc.name} average prep time increased ${Math.round(drift)}%`,
          detail: `${today.avgPrepMinutes.toFixed(1)} min today vs ${base.avgPrepMinutes.toFixed(1)} min 7-day average.`,
          href: `/kitchen?location=${loc.id}`,
        });
      }
    }
    const late = input.ordersToday.filter(
      (o) => o.locationId === loc.id && ACTIVE_STATUSES.includes(o.status) && computeSla(o, input.now, input.sla).level === "critical",
    );
    if (late.length >= 2) {
      alerts.push({
        id: `late:${loc.id}`,
        organizationId: org,
        locationId: loc.id,
        severity: "critical",
        category: "orders",
        title: `${late.length} orders past SLA at ${loc.name}`,
        detail: late.slice(0, 4).map((o) => o.orderNumber).join(", ") + (late.length > 4 ? "…" : ""),
        href: `/orders?location=${loc.id}&delayed=1`,
      });
    }
  }

  // Channels ----------------------------------------------------------------------
  for (const c of input.connections) {
    if (c.status === "connected") continue;
    alerts.push({
      id: `conn:${c.id}:${c.status}`,
      organizationId: org,
      locationId: c.locationId,
      channel: c.channel,
      severity: c.status === "disconnected" ? "critical" : "warning",
      category: "channel",
      title: `${channelName(c.channel)} ${c.status === "disconnected" ? "disconnected" : "connection delayed"} at ${locName(c.locationId)}`,
      detail: c.message ?? (c.status === "degraded" ? `Latency ${c.latencyMs}ms` : "Orders will queue on the platform until reconnected."),
      href: `/channels?channel=${c.channel}`,
    });
  }

  const channels = new Set(input.ordersToday.map((o) => o.channel));
  for (const ch of channels) {
    const today = input.ordersToday.filter((o) => o.channel === ch);
    const base = input.ordersBaseline.filter((o) => o.channel === ch);
    const t = summarize(today);
    const b = summarize(base);
    if (t.cancelledOrders >= 3 && t.cancellationRate >= Math.max(2 * b.cancellationRate, 4)) {
      alerts.push({
        id: `cancel:${ch}`,
        organizationId: org,
        channel: ch as OrderChannel,
        severity: "warning",
        category: "orders",
        title: `${channelName(ch as OrderChannel)} cancellations increased today`,
        detail: `${t.cancellationRate.toFixed(1)}% of orders cancelled today (${t.cancelledOrders}) vs ${b.cancellationRate.toFixed(1)}% 7-day average.`,
        href: `/orders?channel=${ch}&status=cancelled&range=today`,
      });
    }
  }

  // Menu mapping --------------------------------------------------------------------
  const problems = new Map<OrderChannel, number>();
  for (const m of input.mappings) {
    if (m.status === "missing" || m.status === "error" || m.status === "out_of_sync") {
      problems.set(m.channel, (problems.get(m.channel) ?? 0) + 1);
    }
  }
  for (const [ch, n] of problems) {
    alerts.push({
      id: `menu:${ch}`,
      organizationId: org,
      channel: ch,
      severity: "info",
      category: "menu",
      title: `${n} menu item${n > 1 ? "s" : ""} not in sync on ${channelName(ch)}`,
      detail: "Master menu differs from the marketplace listing.",
      href: `/menu?channel=${ch}`,
    });
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

