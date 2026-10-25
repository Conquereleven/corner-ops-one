import { formatAED, formatDecimal } from "@/lib/format";
import type { Insight, OperationsBriefing, OperationsSnapshot, SuggestedAction } from "./types";

const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
const locHref = (id: string, page: string) => `/${page}?location=${id}`;

function runoutText(hours: number | null) {
  if (hours === null) return null;
  if (hours < 1) return "within the hour";
  return `within approximately ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"}`;
}

export function buildBriefing(s: OperationsSnapshot): OperationsBriefing {
  const briefing: Insight[] = [];
  const opportunities: Insight[] = [];
  const risks: Insight[] = [];
  const actions: SuggestedAction[] = [];

  // ---- Briefing ---------------------------------------------------------------
  const revDelta = pct(s.today.revenue, s.yesterdaySameTime.revenue);
  briefing.push({
    id: "rev",
    tone: revDelta >= 0 ? "positive" : "negative",
    text: `Revenue is ${Math.abs(revDelta).toFixed(0)}% ${revDelta >= 0 ? "above" : "below"} the same time yesterday (${formatAED(s.today.revenue)} vs ${formatAED(s.yesterdaySameTime.revenue)}) on ${s.today.orders} orders.`,
    href: "/analytics",
  });
  const drifts = s.locations
    .filter((l) => l.prepToday && l.prepBaseline && pct(l.prepToday, l.prepBaseline) >= 10)
    .sort((a, b) => pct(b.prepToday!, b.prepBaseline!) - pct(a.prepToday!, a.prepBaseline!));
  for (const l of drifts.slice(0, 2)) {
    briefing.push({
      id: `prep-${l.id}`,
      tone: "negative",
      text: `${l.name} preparation time increased from ${Math.round(l.prepBaseline!)} to ${Math.round(l.prepToday!)} minutes versus its 7-day average.`,
      href: locHref(l.id, "kitchen"),
    });
  }
  const soonest = s.stockRisks.filter((r) => r.status !== "out" && r.hoursLeft !== null && r.hoursLeft < 8).sort((a, b) => a.hoursLeft! - b.hoursLeft!)[0];
  if (soonest) {
    briefing.push({
      id: `stock-${soonest.key}-${soonest.locationId}`,
      tone: "negative",
      text: `${soonest.affectedItems[0] ?? soonest.ingredient} may run out at ${soonest.locationName} ${runoutText(soonest.hoursLeft)} — ${soonest.ingredient} is at ${formatDecimal(soonest.quantity)} ${soonest.unit}.`,
      href: "/inventory",
    });
  }
  const bestLoc = [...s.locations].sort((a, b) => b.revenueToday - a.revenueToday)[0];
  if (bestLoc && s.locations.length > 1) {
    briefing.push({
      id: "best-loc",
      tone: "neutral",
      text: `${bestLoc.name} leads today with ${formatAED(bestLoc.revenueToday)} across ${bestLoc.ordersToday} orders.`,
      href: "/locations",
    });
  }

  // ---- Opportunities -------------------------------------------------------------
  const marketplaces = s.channels.filter((c) => c.kind === "marketplace" && c.ordersToday >= 3);
  const talabat = marketplaces.find((c) => c.channel === "talabat");
  const highestAov = [...marketplaces].sort((a, b) => b.aovToday - a.aovToday)[0];
  if (talabat && highestAov && highestAov.channel !== "talabat" && highestAov.aovToday - talabat.aovToday >= 3) {
    opportunities.push({
      id: "aov",
      tone: "positive",
      text: `${highestAov.name} AOV is AED ${Math.round(highestAov.aovToday - talabat.aovToday)} higher than Talabat today (${formatAED(highestAov.aovToday)} vs ${formatAED(talabat.aovToday)}). Bundles or upsells on Talabat could close the gap.`,
      href: "/analytics",
    });
  }
  const owned = s.channels.filter((c) => c.kind === "owned" && c.orders7d > 0).sort((a, b) => b.marginPct7d - a.marginPct7d)[0];
  const worstMarket = s.channels.filter((c) => c.kind === "marketplace" && c.orders7d > 0).sort((a, b) => a.marginPct7d - b.marginPct7d)[0];
  if (owned && worstMarket) {
    const perOrder = owned.contributionPerOrder7d - worstMarket.contributionPerOrder7d;
    opportunities.push({
      id: "direct",
      tone: "positive",
      text: `${owned.name} orders keep ${owned.marginPct7d.toFixed(0)}% of sales as contribution vs ${worstMarket.marginPct7d.toFixed(0)}% on ${worstMarket.name}${perOrder > 0 ? ` — about ${formatAED(perOrder)} more per order` : ""}. Moving repeat customers to direct ordering compounds quickly.`,
      href: "/profitability",
    });
  }
  for (const gap of s.menuGaps.filter((g) => g.missing.length > 0).slice(0, 1)) {
    const name = s.channels.find((c) => c.channel === gap.channel)?.name ?? gap.channel;
    opportunities.push({
      id: `gap-${gap.channel}`,
      tone: "neutral",
      text: `${gap.missing.length} menu item${gap.missing.length > 1 ? "s are" : " is"} not listed on ${name} (${gap.missing.slice(0, 3).join(", ")}). Listing them widens reach at no extra cost.`,
      href: `/menu?channel=${gap.channel}`,
    });
  }
  const topProduct = s.products.top[0];
  if (topProduct) {
    opportunities.push({
      id: "top-product",
      tone: "neutral",
      text: `${topProduct.name} is the top seller this week (${topProduct.quantity} sold${topProduct.marginPct !== undefined ? `, ${topProduct.marginPct.toFixed(0)}% food margin` : ""}). Feature it in marketplace hero slots.`,
      href: "/analytics",
    });
  }

  // ---- Risks ----------------------------------------------------------------------
  const delayedByLoc = new Map<string, number>();
  for (const d of s.delayedOrders) delayedByLoc.set(d.locationName, (delayedByLoc.get(d.locationName) ?? 0) + 1);
  for (const [name, count] of [...delayedByLoc].sort((a, b) => b[1] - a[1])) {
    if (count < 2) continue;
    const target = s.delayedOrders.find((d) => d.locationName === name)!.targetMinutes;
    risks.push({ id: `late-${name}`, tone: "negative", text: `${name} has ${count} orders above the ${target}-minute preparation target right now.`, href: "/orders?delayed=1" });
  }
  for (const c of s.channels) {
    if (c.cancelledToday >= 3 && c.cancellationRateToday >= Math.max(2 * c.cancellationRateBaseline, 4)) {
      risks.push({ id: `cancel-${c.channel}`, tone: "negative", text: `${c.name} cancellations are at ${c.cancellationRateToday.toFixed(1)}% today vs ${c.cancellationRateBaseline.toFixed(1)}% normally (${c.cancelledToday} orders).`, href: `/orders?channel=${c.channel}&status=cancelled&range=today` });
    }
    if (c.status !== "connected") {
      risks.push({ id: `conn-${c.channel}`, tone: "negative", text: `${c.name} integration is ${c.status}${c.statusMessage ? `: ${c.statusMessage.toLowerCase()}` : ""}. Orders may arrive late.`, href: "/channels" });
    }
  }
  for (const r of s.stockRisks.filter((r) => r.status === "out")) {
    risks.push({ id: `out-${r.key}-${r.locationId}`, tone: "negative", text: `${r.ingredient} is out of stock at ${r.locationName}; ${r.affectedItems.join(", ")} ${r.affectedItems.length > 1 ? "are" : "is"} unavailable there.`, href: "/inventory" });
  }
  if (s.concentration.topMarketplace && s.concentration.shareOfDeliveryPct >= 40) {
    const name = s.channels.find((c) => c.channel === s.concentration.topMarketplace)?.name;
    risks.push({ id: "concentration", tone: "neutral", text: `${Math.round(s.concentration.shareOfDeliveryPct)}% of delivery-platform revenue depends on ${name}. A ranking or commission change there hits the whole business.`, href: "/analytics" });
  }

  // ---- Suggested actions ------------------------------------------------------------
  for (const promo of s.promotedItems) {
    const risk = s.stockRisks.find((r) => promo.recipeKeys.includes(r.key) && r.status !== "healthy");
    if (risk) {
      actions.push({
        id: `pause-promo-${promo.name}`,
        title: `Pause ${promo.name} promotion at ${risk.locationName}`,
        rationale: `${risk.ingredient} is ${risk.status === "out" ? "out of stock" : `${risk.status} (${formatDecimal(risk.quantity)} ${risk.unit})`}. Promoting it drives orders the kitchen may not fulfil.`,
        impact: "high",
        cta: { label: "Review menu", href: "/menu" },
      });
    }
  }
  for (const r of s.stockRisks.filter((r) => r.transferFrom && (r.status === "out" || r.status === "critical")).slice(0, 2)) {
    actions.push({
      id: `transfer-${r.key}-${r.locationId}`,
      title: `Transfer ${r.ingredient.toLowerCase()} from ${r.transferFrom!.locationName} to ${r.locationName}`,
      rationale: `${r.transferFrom!.locationName} holds ${formatDecimal(r.transferFrom!.quantity)} ${r.unit}. Restores ${r.affectedItems.slice(0, 2).join(" and ")} before the dinner peak.`,
      impact: "medium",
      cta: { label: "Record transfer", href: `/inventory?q=${encodeURIComponent(r.ingredient)}` },
    });
  }
  for (const [name, count] of delayedByLoc) {
    if (count < 3) continue;
    actions.push({
      id: `busy-${name}`,
      title: `Add 10 minutes to marketplace prep time at ${name}`,
      rationale: `${count} orders are late. Extending quoted prep time on Talabat and Deliveroo for 30 minutes protects ratings while the kitchen catches up.`,
      impact: "high",
      cta: { label: "Open kitchen", href: "/kitchen" },
    });
  }
  for (const c of s.channels.filter((c) => c.status !== "connected")) {
    actions.push({
      id: `reconnect-${c.channel}`,
      title: `Reconnect ${c.name}`,
      rationale: c.statusMessage ?? "Connection is unstable.",
      impact: "medium",
      cta: { label: "Open channels", href: "/channels" },
    });
  }
  for (const gap of s.menuGaps.filter((g) => g.missing.length > 0).slice(0, 1)) {
    const name = s.channels.find((c) => c.channel === gap.channel)?.name ?? gap.channel;
    actions.push({
      id: `publish-${gap.channel}`,
      title: `Publish ${gap.missing.length} missing item${gap.missing.length > 1 ? "s" : ""} to ${name}`,
      rationale: `${gap.missing.join(", ")} exist in the master menu but not on ${name}.`,
      impact: "low",
      cta: { label: "Open menu mapping", href: `/menu?channel=${gap.channel}` },
    });
  }

  const headline =
    risks.length > 0
      ? `${revDelta >= 0 ? "Trading ahead of yesterday" : "Trading behind yesterday"}, with ${risks.length} operational risk${risks.length === 1 ? "" : "s"} to address.`
      : `${revDelta >= 0 ? "Trading ahead of yesterday" : "Trading behind yesterday"} and operations are stable.`;

  return { generatedAt: s.generatedAt, headline, briefing, opportunities, risks, actions };
}
