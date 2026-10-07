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
import type { LocationScope } from "@/domain/locations/types";
import { DAY, startOfDubaiDay, toMs } from "@/lib/time";
import type { Runtime } from "../store/runtime";
import { live, ordersBetween } from "./context";

function historyStart(rt: Runtime) {
  return startOfDubaiDay(rt.db.seededAt) - 30 * DAY;
}

export function computeAnalytics(rt: Runtime, scope: LocationScope, range: AnalyticsRange, now: number) {
  const { db } = rt;
  const r = resolveRange(range, now, historyStart(rt));
  const current = ordersBetween(rt, scope, r.start, r.end);
  const previous = r.prevStart !== null ? ordersBetween(rt, scope, r.prevStart, r.prevEnd!) : [];
  const cur = summarize(current);
  const prev = r.prevStart !== null ? summarize(previous) : null;

  const today = startOfDubaiDay(now);
  const periodRevenue = (start: number, end: number) => summarize(ordersBetween(rt, scope, start, end)).revenue;
  const revenueCards = [
    { key: "today", label: "Today", ...compare(periodRevenue(today, now + 1), periodRevenue(today - DAY, now - DAY)), comparisonLabel: "vs same time yesterday" },
    { key: "yesterday", label: "Yesterday", ...compare(periodRevenue(today - DAY, today), periodRevenue(today - 2 * DAY, today - DAY)), comparisonLabel: "vs day before" },
    { key: "7d", label: "Last 7 days", ...compare(periodRevenue(today - 6 * DAY, now + 1), periodRevenue(today - 13 * DAY, now - 7 * DAY)), comparisonLabel: "vs previous 7 days" },
    { key: "30d", label: "Last 30 days", ...compare(periodRevenue(today - 29 * DAY, now + 1), null), comparisonLabel: `${Math.round((now - historyStart(rt)) / DAY)} days of history` },
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

  const byLocation = db.locations
    .filter((l) => scope === "all" || l.id === scope)
    .map((l) => {
      const s = summarize(current.filter((o) => o.locationId === l.id));
      const p = r.prevStart !== null ? summarize(previous.filter((o) => o.locationId === l.id)) : null;
      return { locationId: l.id, name: l.name, ...s, revenueDeltaPct: p ? compare(s.revenue, p.revenue).deltaPct : null };
    });

  const days = Math.max(1, (r.end - r.start) / DAY);
  const products = productPerformance(current, db.menuItems);
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
  const rows = computeChannelProfitability(current, db.settings.economics, db.menuItems);

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

export async function getAnalytics(scope: LocationScope, range: AnalyticsRange) {
  const rt = await live();
  return computeAnalytics(rt, scope, range, Date.now());
}
export type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;

export async function getProfitability(scope: LocationScope, range: AnalyticsRange) {
  const rt = await live();
  const now = Date.now();
  const r = resolveRange(range, now, historyStart(rt));
  const current = ordersBetween(rt, scope, r.start, r.end);
  const rows = computeChannelProfitability(current, rt.db.settings.economics, rt.db.menuItems).sort(
    (a, b) => b.contribution - a.contribution,
  );
  const totals = totalProfitability(rows);
  const byMargin = [...rows].sort((a, b) => b.marginPct - a.marginPct);
  const byLocation = rt.db.locations
    .filter((l) => scope === "all" || l.id === scope)
    .map((l) => {
      const lr = computeChannelProfitability(current.filter((o) => o.locationId === l.id), rt.db.settings.economics, rt.db.menuItems);
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
    economics: rt.db.settings.economics,
  };
}
export type ProfitabilityData = Awaited<ReturnType<typeof getProfitability>>;
