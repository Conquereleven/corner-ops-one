import "server-only";
import {
  compare,
  dailyBuckets,
  groupBy,
  hourOfDayProfile,
  hourlyBuckets,
  productPerformance,
  summarize,
} from "@/domain/analytics/metrics";
import { computeChannelProfitability, totalProfitability } from "@/domain/analytics/profitability";
import { resolveRange, type AnalyticsRange } from "@/domain/analytics/range";
import { CHANNEL_CATALOG, MARKETPLACE_CHANNELS, ORDER_CHANNELS } from "@/domain/channels/types";
import { DAY, startOfDubaiDay, toMs } from "@/lib/time";
import type { Location } from "@/domain/locations/types";
import type { MenuItem } from "@/domain/menu/types";
import type { ChannelEconomics, OrderChannel } from "@/domain/channels/types";
import type { UnifiedOrder } from "@/domain/orders/types";
import { requirePermission, type AppContext } from "../context/app-context";

export interface AnalyticsInput {
  /** Orders in scope covering every window the computation needs. */
  orders: UnifiedOrder[];
  locations: Location[];
  menuItems: MenuItem[];
  economics: Record<OrderChannel, ChannelEconomics>;
  /** First order on record (ms). */
  historyStart: number;
}

function betweenFn(orders: UnifiedOrder[]) {
  return (start: number, end: number) =>
    orders.filter((o) => {
      const t = Date.parse(o.placedAt);
      return t >= start && t < end;
    });
}

async function loadAnalyticsInput(ctx: AppContext, range: AnalyticsRange): Promise<AnalyticsInput> {
  const now = ctx.now;
  const today = startOfDubaiDay(now);
  const first = (await ctx.repos.orders.firstPlacedAt(ctx.scope.locationIds)) ?? today;
  const r = resolveRange(range, now, first);
  const from = Math.min(today - 29 * DAY, today - 13 * DAY, r.prevStart ?? Infinity);
  const [orders, menu, settings] = await Promise.all([ctx.data.orders({ from, to: now + 1, withItems: true }), ctx.data.menu(), ctx.data.settings()]);
  return {
    orders,
    locations: ctx.allowedLocations.filter((l) => ctx.scope.locationIds.includes(l.id)),
    menuItems: menu.items,
    economics: settings.economics,
    historyStart: first,
  };
}

export function computeAnalytics(input: AnalyticsInput, range: AnalyticsRange, now: number) {
  const ordersBetween = betweenFn(input.orders);
  const r = resolveRange(range, now, input.historyStart);
  const current = ordersBetween(r.start, r.end);
  const previous = r.prevStart !== null ? ordersBetween(r.prevStart, r.prevEnd!) : [];
  const cur = summarize(current);
  const prev = r.prevStart !== null ? summarize(previous) : null;

  const today = startOfDubaiDay(now);
  const periodRevenue = (start: number, end: number) => summarize(ordersBetween(start, end)).revenue;
  const revenueCards = [
    { key: "today", label: "Today", ...compare(periodRevenue(today, now + 1), periodRevenue(today - DAY, now - DAY)), comparisonLabel: "vs same time yesterday" },
    { key: "yesterday", label: "Yesterday", ...compare(periodRevenue(today - DAY, today), periodRevenue(today - 2 * DAY, today - DAY)), comparisonLabel: "vs day before" },
    { key: "7d", label: "Last 7 days", ...compare(periodRevenue(today - 6 * DAY, now + 1), periodRevenue(today - 13 * DAY, now - 7 * DAY)), comparisonLabel: "vs previous 7 days" },
    { key: "30d", label: "Last 30 days", ...compare(periodRevenue(today - 29 * DAY, now + 1), null), comparisonLabel: `${Math.round((now - input.historyStart) / DAY)} days of history` },
  ];

  let trend =
    r.bucket === "hour" ? hourlyBuckets(current, r.start, Math.min(r.end, r.start + DAY)) : dailyBuckets(current, r.start, r.end);
  if (r.prevStart !== null) {
    const prevBuckets =
      r.bucket === "hour"
        ? hourlyBuckets(previous, r.prevStart, r.prevStart + (Math.min(r.end, r.start + DAY) - r.start))
        : dailyBuckets(previous, r.prevStart, r.prevStart + (r.end - r.start));
    trend = trend.map((b, i) => ({ ...b, previousRevenue: prevBuckets[i]?.revenue, previousOrders: prevBuckets[i]?.orders }));
  }
  if (r.bucket === "hour") {
    const first = trend.findIndex((b) => b.orders > 0 || (b.previousOrders ?? 0) > 0);
    if (first > 0) trend = trend.slice(first);
  }

  const byChannelPrev = groupBy(previous, (o) => o.channel);
  const byChannel = ORDER_CHANNELS.map((channel) => {
    const s = summarize(current.filter((o) => o.channel === channel));
    const p = r.prevStart !== null ? summarize(byChannelPrev.get(channel) ?? []) : null;
    return {
      channel,
      ...s,
      share: cur.revenue ? (s.revenue / cur.revenue) * 100 : 0,
      revenueDeltaPct: p ? compare(s.revenue, p.revenue).deltaPct : null,
    };
  }).filter((c) => c.orders > 0);

  const byLocation = input.locations
    .map((l) => {
      const s = summarize(current.filter((o) => o.locationId === l.id));
      const p = r.prevStart !== null ? summarize(previous.filter((o) => o.locationId === l.id)) : null;
      return { locationId: l.id, name: l.name, ...s, revenueDeltaPct: p ? compare(s.revenue, p.revenue).deltaPct : null };
    });

  const days = Math.max(1, (r.end - r.start) / DAY);
  const products = productPerformance(current, input.menuItems);
  const sorted = [...products].sort((a, b) => b.revenue - a.revenue);

  const marketplaceRevenue = byChannel
    .filter((c) => (MARKETPLACE_CHANNELS as readonly string[]).includes(c.channel))
    .reduce((s, c) => s + c.revenue, 0);
  const marketplaces = byChannel.filter((c) => (MARKETPLACE_CHANNELS as readonly string[]).includes(c.channel));
  const topMarketplace = [...marketplaces].sort((a, b) => b.revenue - a.revenue)[0];
  const hhi = byChannel.reduce((s, c) => s + (c.share / 100) ** 2, 0);
  const concentration = {
    marketplaceSharePct: cur.revenue ? (marketplaceRevenue / cur.revenue) * 100 : 0,
    ownedSharePct: cur.revenue ? ((cur.revenue - marketplaceRevenue) / cur.revenue) * 100 : 0,
    topMarketplace: topMarketplace?.channel ?? null,
    /** Share of marketplace (delivery-platform) revenue held by the largest platform. */
    topMarketplaceShareOfDeliveryPct: topMarketplace && marketplaceRevenue ? (topMarketplace.revenue / marketplaceRevenue) * 100 : 0,
    topMarketplaceShareOfTotalPct: topMarketplace?.share ?? 0,
    hhi,
    level: (hhi > 0.25 ? "high" : hhi > 0.18 ? "moderate" : "low") as "high" | "moderate" | "low",
  };

  const prepByLocation = byLocation.map((l) => ({ name: l.name, avgPrepMinutes: l.avgPrepMinutes }));
  const rows = computeChannelProfitability(current, input.economics, input.menuItems);

  return {
    range: r.range,
    label: r.label,
    comparisonLabel: r.comparisonLabel,
    bucket: r.bucket,
    summary: {
      revenue: compare(cur.revenue, prev?.revenue ?? null),
      orders: compare(cur.orders, prev?.orders ?? null),
      aov: compare(cur.aov, prev?.aov ?? null),
      avgPrepMinutes: compare(cur.avgPrepMinutes, prev?.avgPrepMinutes ?? null),
      cancellationRate: compare(cur.cancellationRate, prev?.cancellationRate ?? null),
    },
    revenueCards,
    trend,
    byChannel,
    byLocation,
    prepByLocation,
    hourProfile: hourOfDayProfile(current, days),
    topProducts: sorted.slice(0, 8),
    bottomProducts: sorted.filter((p) => p.categoryId !== "cat_sides").slice(-5).reverse(),
    concentration,
    profitability: { rows, totals: totalProfitability(rows) },
    channelNames: Object.fromEntries(ORDER_CHANNELS.map((c) => [c, CHANNEL_CATALOG[c].name])),
    orderCount: current.length,
    firstOrderAt: current.length ? Math.min(...current.map((o) => toMs(o.placedAt)!)) : null,
  };
}

export async function getAnalytics(ctx: AppContext, range: AnalyticsRange) {
  requirePermission(ctx, "analytics.view");
  const data = computeAnalytics(await loadAnalyticsInput(ctx, range), range, ctx.now);
  // Contribution figures are financial: only roles with profitability access receive them.
  return ctx.permissions.has("profitability.view") ? data : { ...data, profitability: null };
}
export type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;

export async function getProfitability(ctx: AppContext, range: AnalyticsRange) {
  requirePermission(ctx, "profitability.view");
  const input = await loadAnalyticsInput(ctx, range);
  const now = ctx.now;
  const r = resolveRange(range, now, input.historyStart);
  const current = betweenFn(input.orders)(r.start, r.end);
  const rows = computeChannelProfitability(current, input.economics, input.menuItems).sort((a, b) => b.contribution - a.contribution);
  const totals = totalProfitability(rows);
  const byMargin = [...rows].sort((a, b) => b.marginPct - a.marginPct);
  const byLocation = input.locations.map((l) => {
    const lr = computeChannelProfitability(current.filter((o) => o.locationId === l.id), input.economics, input.menuItems);
    return { locationId: l.id, name: l.name, ...totalProfitability(lr) };
  });
  return {
    range: r.range,
    label: r.label,
    rows,
    totals,
    byLocation,
    bestMargin: byMargin[0] ?? null,
    worstMargin: byMargin.at(-1) ?? null,
    topContributor: rows[0] ?? null,
    economics: input.economics,
  };
}
export type ProfitabilityData = Awaited<ReturnType<typeof getProfitability>>;
