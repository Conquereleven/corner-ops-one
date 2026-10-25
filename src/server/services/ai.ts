import "server-only";
import { z } from "zod";
import { deterministicProvider } from "@/domain/ai/deterministic-provider";
import { buildBriefing } from "@/domain/ai/insights";
import type { OperationsAIProvider, OperationsSnapshot, StockRisk } from "@/domain/ai/types";
import { productPerformance, summarize } from "@/domain/analytics/metrics";
import { computeChannelProfitability } from "@/domain/analytics/profitability";
import { CHANNEL_CATALOG, ORDER_CHANNELS } from "@/domain/channels/types";
import { hoursUntilStockout, usageRates } from "@/domain/inventory/forecast";
import { stockStatus } from "@/domain/inventory/types";
import type { ChannelConnection } from "@/domain/channels/types";
import type { InventoryItem } from "@/domain/inventory/types";
import type { Location } from "@/domain/locations/types";
import type { MenuChannelMapping, MenuItem } from "@/domain/menu/types";
import type { UnifiedOrder } from "@/domain/orders/types";
import { computeSla } from "@/domain/orders/sla";
import { ACTIVE_STATUSES } from "@/domain/orders/types";
import { DAY, HOUR, MINUTE, startOfDubaiDay } from "@/lib/time";
import { requirePermission, type AppContext } from "../context/app-context";
import type { WorkspaceSettings } from "../store/types";
import { channelHealthSummary } from "./channel-health";
import { todayWindow } from "./windows";

/** Provider registry. Add an LLM-backed provider here; keep API keys server-side. */
const providers: Record<string, OperationsAIProvider> = { deterministic: deterministicProvider };

function provider(settings: WorkspaceSettings): OperationsAIProvider {
  return providers[settings.aiProvider] ?? deterministicProvider;
}

/** Everything the analyst may look at — loaded from the persistent operations layer. */
export interface SnapshotInput {
  scopeLabel: string;
  /** Orders in scope placed since 7 days before today, with items. */
  orders: UnifiedOrder[];
  active: UnifiedOrder[];
  /** Locations in scope. */
  locations: Location[];
  /** All locations the user may access (for transfer suggestions). */
  allowedLocations: Location[];
  inventory: InventoryItem[];
  allowedInventory: InventoryItem[];
  menuItems: MenuItem[];
  mappings: MenuChannelMapping[];
  connections: ChannelConnection[];
  settings: WorkspaceSettings;
}

export function buildSnapshot(input: SnapshotInput, now: number): OperationsSnapshot {
  const db = { settings: input.settings, menuItems: input.menuItems, menuMappings: input.mappings };
  const ordersBetween = (a: number, b: number) => input.orders.filter((o) => { const t = Date.parse(o.placedAt); return t >= a && t < b; });
  const { start, yStart, yEnd } = todayWindow(now);
  const today = ordersBetween(start, now + 1);
  const yesterday = ordersBetween(yStart, yEnd);
  const week = ordersBetween(start - 7 * DAY, start);
  const last7 = ordersBetween(start - 6 * DAY, now + 1);
  const t = summarize(today);
  const y = summarize(yesterday);
  const locs = input.locations;
  const locName = (id: string) => input.allowedLocations.find((l) => l.id === id)?.name ?? id;

  const rates = usageRates(ordersBetween(now - 4 * HOUR, now + 1), input.menuItems, now);
  const stockRisks: StockRisk[] = input.inventory
    .filter((i) => stockStatus(i) !== "healthy")
    .map((i) => {
      const donor = input.allowedInventory
        .filter((x) => x.key === i.key && x.locationId !== i.locationId && x.quantity > x.parLevel * 0.6)
        .sort((a, b) => b.quantity - a.quantity)[0];
      return {
        key: i.key,
        ingredient: i.name,
        locationId: i.locationId,
        locationName: locName(i.locationId),
        status: stockStatus(i),
        quantity: i.quantity,
        unit: i.unit,
        hoursLeft: hoursUntilStockout(i, rates.get(`${i.locationId}:${i.key}`)),
        hoursToClose: hoursUntilClose(input.allowedLocations.find((l) => l.id === i.locationId)?.operatingHours.close ?? "00:00", now),
        affectedItems: db.menuItems.filter((m) => m.recipe.some((r) => r.inventoryItemKey === i.key)).map((m) => m.name),
        transferFrom: donor ? { locationName: locName(donor.locationId), quantity: donor.quantity } : undefined,
      };
    });

  const profit = db.settings.economics ? computeChannelProfitability(last7, db.settings.economics, db.menuItems) : [];
  const health = channelHealthSummary(input.connections, today);
  const channels = ORDER_CHANNELS.filter((c) => health.find((h) => h.channel === c)?.covered).map((channel) => {
    const ct = summarize(today.filter((o) => o.channel === channel));
    const cy = summarize(yesterday.filter((o) => o.channel === channel));
    const cw = summarize(week.filter((o) => o.channel === channel));
    const p = profit.find((r) => r.channel === channel);
    const h = health.find((x) => x.channel === channel)!;
    return {
      channel,
      name: CHANNEL_CATALOG[channel].name,
      kind: CHANNEL_CATALOG[channel].kind,
      status: h.status,
      statusMessage: h.message,
      revenueToday: ct.revenue,
      revenueYesterday: cy.revenue,
      ordersToday: ct.orders,
      aovToday: ct.aov,
      cancellationRateToday: ct.cancellationRate,
      cancellationRateBaseline: cw.cancellationRate,
      cancelledToday: ct.cancelledOrders,
      marginPct7d: p?.marginPct ?? 0,
      contribution7d: p?.contribution ?? 0,
      contributionPerOrder7d: p?.contributionPerOrder ?? 0,
      grossSales7d: p?.grossSales ?? 0,
      orders7d: p?.orders ?? 0,
    };
  });

  const products = productPerformance(last7, db.menuItems).sort((a, b) => b.revenue - a.revenue);
  const marketplaceRev = channels.filter((c) => c.kind === "marketplace");
  const totalMarket = marketplaceRev.reduce((s, c) => s + c.grossSales7d, 0);
  const topMarket = [...marketplaceRev].sort((a, b) => b.grossSales7d - a.grossSales7d)[0];
  const totalRev7 = channels.reduce((s, c) => s + c.grossSales7d, 0);

  const active = input.active.filter((o) => ACTIVE_STATUSES.includes(o.status));
  const delayedOrders = active
    .map((o) => ({ o, sla: computeSla(o, now, db.settings.sla) }))
    .filter((x) => x.sla.level === "critical")
    .map((x) => ({
      orderNumber: x.o.orderNumber,
      locationName: locName(x.o.locationId),
      channel: x.o.channel,
      minutesInStage: Math.round(x.sla.elapsedMs / MINUTE),
      targetMinutes: Math.round(x.sla.targetMs / MINUTE),
    }));

  return {
    generatedAt: new Date(now).toISOString(),
    scopeLabel: input.scopeLabel,
    today: { revenue: t.revenue, orders: t.orders, aov: t.aov, avgPrepMinutes: t.avgPrepMinutes, cancellationRate: t.cancellationRate },
    yesterdaySameTime: { revenue: y.revenue, orders: y.orders, aov: y.aov, avgPrepMinutes: y.avgPrepMinutes, cancellationRate: y.cancellationRate },
    locations: locs.map((l) => {
      const lt = summarize(today.filter((o) => o.locationId === l.id));
      const ly = summarize(yesterday.filter((o) => o.locationId === l.id));
      const lw = summarize(week.filter((o) => o.locationId === l.id));
      const la = active.filter((o) => o.locationId === l.id);
      return {
        id: l.id,
        name: l.name,
        revenueToday: lt.revenue,
        revenueYesterday: ly.revenue,
        ordersToday: lt.orders,
        prepToday: lt.avgPrepMinutes,
        prepBaseline: lw.avgPrepMinutes,
        activeOrders: la.length,
        delayedOrders: delayedOrders.filter((d) => d.locationName === l.name).length,
        kitchenLoadPct: Math.round((la.filter((o) => o.status === "accepted" || o.status === "preparing").length / l.kitchenCapacity) * 100),
        cancellationRate: lt.cancellationRate,
      };
    }),
    channels,
    stockRisks,
    delayedOrders,
    products: {
      top: products.slice(0, 6).map((p) => ({ name: p.name, quantity: p.quantity, revenue: p.revenue, marginPct: p.marginPct })),
      bottom: products.slice(-4).reverse().map((p) => ({ name: p.name, quantity: p.quantity, revenue: p.revenue, marginPct: p.marginPct })),
    },
    concentration: {
      topMarketplace: topMarket?.channel ?? null,
      shareOfDeliveryPct: topMarket && totalMarket ? (topMarket.grossSales7d / totalMarket) * 100 : 0,
      marketplaceSharePct: totalRev7 ? (totalMarket / totalRev7) * 100 : 0,
    },
    menuGaps: ORDER_CHANNELS.map((channel) => ({
      channel,
      missing: db.menuMappings
        .filter((m) => m.channel === channel && m.status === "missing")
        .map((m) => db.menuItems.find((i) => i.id === m.menuItemId)!.name),
    })).filter((g) => g.missing.length),
    promotedItems: db.menuItems
      .filter((m) => m.tags.includes("promo"))
      .map((m) => ({ name: m.name, tags: m.tags, recipeKeys: m.recipe.map((r) => r.inventoryItemKey) })),
  };
}

/** Hours from `now` until the next occurrence of a Dubai-local "HH:MM" closing time. */
function hoursUntilClose(close: string, now: number): number {
  const [h, m] = close.split(":").map(Number);
  const dayStart = startOfDubaiDay(now);
  let closeTs = dayStart + h * HOUR + m * MINUTE;
  // Closing times after midnight belong to the same trading night.
  if (h < 6) closeTs += DAY;
  if (closeTs <= now) closeTs += DAY;
  return (closeTs - now) / HOUR;
}

async function loadSnapshot(ctx: AppContext): Promise<{ snapshot: OperationsSnapshot; settings: WorkspaceSettings }> {
  const now = ctx.now;
  const { start } = todayWindow(now);
  const [orders, active, inventory, allowedInventory, menu, connections, settings] = await Promise.all([
    ctx.data.orders({ from: start - 7 * DAY, to: now + 1, withItems: true }),
    ctx.data.activeOrders(),
    ctx.data.inventory(),
    ctx.repos.inventory.items(ctx.allowedLocations.map((l) => l.id)),
    ctx.data.menu(),
    ctx.data.connections(),
    ctx.data.settings(),
  ]);
  const snapshot = buildSnapshot(
    {
      scopeLabel: ctx.scope.label,
      orders,
      active,
      locations: ctx.allowedLocations.filter((l) => ctx.scope.locationIds.includes(l.id)),
      allowedLocations: ctx.allowedLocations,
      inventory,
      allowedInventory,
      menuItems: menu.items,
      mappings: menu.mappings,
      connections,
      settings,
    },
    now,
  );
  // Financial figures are withheld from roles without profitability access.
  if (!ctx.permissions.has("profitability.view")) {
    snapshot.channels = snapshot.channels.map((c) => ({ ...c, marginPct7d: 0, contribution7d: 0, contributionPerOrder7d: 0 }));
  }
  return { snapshot, settings };
}

export async function getBriefing(ctx: AppContext) {
  requirePermission(ctx, "ai.view");
  const { snapshot, settings } = await loadSnapshot(ctx);
  const briefing = buildBriefing(snapshot);
  if (!ctx.permissions.has("profitability.view")) {
    briefing.opportunities = briefing.opportunities.filter((o) => o.id !== "direct");
  }
  return { ...briefing, provider: provider(settings).label, scopeLabel: snapshot.scopeLabel };
}
export type BriefingData = Awaited<ReturnType<typeof getBriefing>>;

export const askSchema = z.object({ question: z.string().trim().min(2).max(500) });

export async function askCornerOps(ctx: AppContext, question: string) {
  requirePermission(ctx, "ai.view");
  const { snapshot, settings } = await loadSnapshot(ctx);
  if (!ctx.permissions.has("profitability.view") && /\b(profit\w*|margins?|contribution|commissions?)\b/i.test(question)) {
    return {
      question,
      answer: "Profitability figures aren't available for your role. Ask an owner or operations manager.",
      bullets: [],
      sources: [],
      followUps: ["Where are our operational bottlenecks?"],
      provider: provider(settings).label,
      generatedAt: snapshot.generatedAt,
    };
  }
  return provider(settings).answer(question, snapshot);
}
