import { formatAED, formatDecimal } from "@/lib/format";
import { buildBriefing } from "./insights";
import type { AIAnswer, OperationsAIProvider, OperationsSnapshot } from "./types";

const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;

type Intent = "revenue" | "location" | "profit" | "stock" | "bottleneck" | "cancellations" | "products" | "channels" | "summary";

const INTENTS: [Intent, RegExp][] = [
  ["profit", /\b(profit\w*|margins?|make (me )?money|contribution|commissions?)\b/i],
  ["stock", /\b(run(ning)? out|stock|inventory|ingredients?|tonight|86'?d?)\b/i],
  ["bottleneck", /\b(bottlenecks?|slow|delay\w*|late|prep time|kitchen|capacity)\b/i],
  ["cancellations", /\bcancel\w*/i],
  ["revenue", /\b(revenue|sales|drop\w*|down|trading|why)\b/i],
  ["location", /\b(locations?|branch\w*|stores?|best|worst|perform\w*)\b/i],
  ["products", /\b(products?|items?|dish\w*|best.?sell\w*|top sell\w*|menu)\b/i],
  ["channels", /\b(channels?|platforms?|talabat|deliveroo|noon|keeta|whatsapp|direct)\b/i],
];

function detectIntent(q: string): Intent {
  for (const [intent, re] of INTENTS) if (re.test(q)) return intent;
  return "summary";
}

function answerRevenue(s: OperationsSnapshot) {
  const delta = pct(s.today.revenue, s.yesterdaySameTime.revenue);
  const channelMoves = s.channels
    .map((c) => ({ c, diff: c.revenueToday - c.revenueYesterday }))
    .sort((a, b) => a.diff - b.diff);
  const locMoves = s.locations.map((l) => ({ l, diff: l.revenueToday - l.revenueYesterday })).sort((a, b) => a.diff - b.diff);
  const down = delta < 0;
  const answer = down
    ? `Revenue is down ${Math.abs(delta).toFixed(1)}% versus the same time yesterday (${formatAED(s.today.revenue)} vs ${formatAED(s.yesterdaySameTime.revenue)}). The drop is concentrated in ${channelMoves[0].c.name} and ${locMoves[0].l.name}.`
    : `Revenue hasn't dropped — it's ${delta.toFixed(1)}% above the same time yesterday (${formatAED(s.today.revenue)} vs ${formatAED(s.yesterdaySameTime.revenue)}). Here is where the movement comes from.`;
  const bullets = [
    ...channelMoves
      .filter((m) => Math.abs(m.diff) > 50)
      .sort((a, b) => (down ? a.diff - b.diff : b.diff - a.diff))
      .slice(0, 3)
      .map((m) => `${m.c.name}: ${formatAED(m.c.revenueToday)} (${m.diff >= 0 ? "+" : "−"}${formatAED(Math.abs(m.diff))} vs yesterday)`),
    ...locMoves
      .sort((a, b) => (down ? a.diff - b.diff : b.diff - a.diff))
      .slice(0, 2)
      .map((m) => `${m.l.name}: ${formatAED(m.l.revenueToday)} (${signed(pct(m.l.revenueToday, m.l.revenueYesterday))})`),
    `Orders ${s.today.orders} vs ${s.yesterdaySameTime.orders}; AOV ${formatAED(s.today.aov)} vs ${formatAED(s.yesterdaySameTime.aov)}.`,
  ];
  const cancels = s.channels.filter((c) => c.cancellationRateToday > Math.max(2 * c.cancellationRateBaseline, 4));
  if (cancels.length) bullets.push(`Watch cancellations on ${cancels.map((c) => `${c.name} (${c.cancellationRateToday.toFixed(1)}%)`).join(", ")} — lost orders don't count as revenue.`);
  return { answer, bullets, sources: ["Orders today vs same time yesterday", "Revenue by channel & location"] };
}

function answerLocation(s: OperationsSnapshot) {
  const ranked = [...s.locations].sort((a, b) => b.revenueToday - a.revenueToday);
  const best = ranked[0];
  const fastest = [...s.locations].filter((l) => l.prepToday).sort((a, b) => a.prepToday! - b.prepToday!)[0];
  return {
    answer: `${best.name} is performing best on revenue today with ${formatAED(best.revenueToday)} (${signed(pct(best.revenueToday, best.revenueYesterday))} vs yesterday).${fastest && fastest.id !== best.id ? ` ${fastest.name} has the fastest kitchen at ${formatDecimal(fastest.prepToday!)} min average prep.` : ""}`,
    bullets: ranked.map(
      (l, i) =>
        `${i + 1}. ${l.name} — ${formatAED(l.revenueToday)}, ${l.ordersToday} orders, prep ${l.prepToday ? `${formatDecimal(l.prepToday)} min` : "—"}${l.delayedOrders ? `, ${l.delayedOrders} late now` : ""}`,
    ),
    sources: ["Location performance today", "Kitchen SLA (live)"],
  };
}

function answerProfit(s: OperationsSnapshot, question: string) {
  const all = s.channels.filter((c) => c.orders7d > 0).sort((a, b) => b.marginPct7d - a.marginPct7d);
  const marketplacesOnly = /\b(delivery platforms?|marketplaces?|aggregators?|platforms?)\b/i.test(question);
  const ranked = marketplacesOnly ? all.filter((c) => c.kind === "marketplace") : all;
  const best = ranked[0];
  const biggest = [...ranked].sort((a, b) => b.contribution7d - a.contribution7d)[0];
  const worst = ranked.at(-1)!;
  const bestOwned = all.find((c) => c.kind === "owned");
  const noun = marketplacesOnly ? "delivery platform" : "channel";
  const bullets = ranked.map(
    (c) => `${c.name}: ${c.marginPct7d.toFixed(1)}% margin · ${formatAED(c.contribution7d)} contribution · ${formatAED(c.contributionPerOrder7d)}/order`,
  );
  if (marketplacesOnly && bestOwned) {
    bullets.push(`For comparison, ${bestOwned.name} (owned) keeps ${bestOwned.marginPct7d.toFixed(0)}% — ${formatAED(bestOwned.contributionPerOrder7d)}/order.`);
  }
  return {
    answer: `Over the last 7 days, ${best.name} is the most profitable ${noun} per order: it keeps an estimated ${best.marginPct7d.toFixed(0)}% of gross sales as contribution (${formatAED(best.contributionPerOrder7d)} per order). ${biggest.name === best.name ? "It also" : biggest.name} contributes the most in absolute terms (${formatAED(biggest.contribution7d)}), while ${worst.name} has the thinnest margin at ${worst.marginPct7d.toFixed(0)}%.`,
    bullets,
    sources: ["Profitability · last 7 days (estimated from contract terms in Settings)"],
  };
}

function answerStock(s: OperationsSnapshot) {
  const risks = [...s.stockRisks].sort((a, b) => (a.hoursLeft ?? 999) - (b.hoursLeft ?? 999));
  if (!risks.length) return { answer: "No ingredients are below threshold right now.", bullets: [], sources: ["Inventory (live)"] };
  const tonight = risks.filter((r) => r.status === "out" || (r.hoursLeft !== null && r.hoursLeft <= r.hoursToClose));
  const tight = risks.filter((r) => !tonight.includes(r) && r.hoursLeft !== null && r.hoursLeft <= r.hoursToClose + 1);
  const items = [...new Set(tonight.flatMap((r) => r.affectedItems))];
  const tightText = tight.length
    ? ` Cutting it close: ${tight.map((r) => `${r.ingredient} at ${r.locationName} (~${formatDecimal(r.hoursLeft!)}h of stock for ${formatDecimal(r.hoursToClose)}h of trading, affects ${r.affectedItems.slice(0, 2).join(", ")})`).join("; ")}.`
    : "";
  return {
    answer:
      (tonight.length
        ? `${tonight.length} ingredient${tonight.length > 1 ? "s are" : " is"} out or on pace to run out before close, affecting ${items.slice(0, 4).join(", ")}${items.length > 4 ? ` and ${items.length - 4} more` : ""}.`
        : `Nothing is certain to run out before close${tight.length ? "" : `, but ${risks.length} ingredient${risks.length > 1 ? "s are" : " is"} below threshold — reorder before tomorrow's lunch`}.`) + tightText,
    bullets: risks.slice(0, 6).map(
      (r) =>
        `${r.ingredient} @ ${r.locationName}: ${formatDecimal(r.quantity)} ${r.unit} — ${
          r.status === "out"
            ? "OUT, items unavailable"
            : r.hoursLeft !== null
              ? `~${formatDecimal(r.hoursLeft)}h left at current pace (closes in ${formatDecimal(r.hoursToClose)}h)`
              : "not moving"
        }${r.transferFrom ? ` · transfer possible from ${r.transferFrom.locationName}` : ""}`,
    ),
    sources: ["Inventory (live)", "Recipe usage from the last 4 hours of orders", "Location operating hours"],
  };
}

function answerBottleneck(s: OperationsSnapshot) {
  const bullets: string[] = [];
  for (const l of [...s.locations].sort((a, b) => b.delayedOrders - a.delayedOrders)) {
    const drift = l.prepToday && l.prepBaseline ? pct(l.prepToday, l.prepBaseline) : 0;
    bullets.push(
      `${l.name}: ${l.delayedOrders} late orders, kitchen load ${l.kitchenLoadPct}%, prep ${l.prepToday ? formatDecimal(l.prepToday) : "—"} min (${drift ? signed(drift) : "±0%"} vs 7-day)`,
    );
  }
  for (const c of s.channels.filter((c) => c.status !== "connected")) bullets.push(`${c.name} integration ${c.status}: ${c.statusMessage ?? "unstable"}`);
  const worst = [...s.locations].sort((a, b) => b.delayedOrders - a.delayedOrders || b.kitchenLoadPct - a.kitchenLoadPct)[0];
  return {
    answer: worst.delayedOrders
      ? `The main bottleneck is the ${worst.name} kitchen: ${worst.delayedOrders} orders are past target and prep time is running ${worst.prepToday && worst.prepBaseline ? `${formatDecimal(worst.prepToday - worst.prepBaseline)} min slower than usual` : "above normal"}.`
      : `No acute bottleneck — all kitchens are within SLA. ${worst.name} carries the highest load (${worst.kitchenLoadPct}%).`,
    bullets,
    sources: ["Kitchen SLA (live)", "Prep time vs 7-day baseline", "Channel health"],
  };
}

function answerCancellations(s: OperationsSnapshot) {
  const active = s.channels.filter((c) => c.ordersToday > 0);
  // Rank by excess cancellations over baseline, so one cancelled order on a small channel doesn't dominate.
  const excess = (c: (typeof active)[number]) => c.cancelledToday - (c.cancellationRateBaseline / 100) * c.ordersToday;
  const ranked = [...active].sort((a, b) => excess(b) - excess(a));
  const top = ranked[0];
  const plural = (n: number) => `${n} order${n === 1 ? "" : "s"}`;
  const elevated = top && top.cancelledToday >= 2 && top.cancellationRateToday > top.cancellationRateBaseline * 1.5;
  return {
    answer: `Overall cancellation rate today is ${s.today.cancellationRate.toFixed(1)}%. ${
      elevated
        ? `${top.name} stands out: ${top.cancellationRateToday.toFixed(1)}% (${plural(top.cancelledToday)}) against a ${top.cancellationRateBaseline.toFixed(1)}% 7-day baseline.`
        : "No channel is meaningfully above its normal level."
    }`,
    bullets: ranked.map((c) => `${c.name}: ${c.cancellationRateToday.toFixed(1)}% today (${plural(c.cancelledToday)}) vs ${c.cancellationRateBaseline.toFixed(1)}% 7-day`),
    sources: ["Orders today", "7-day cancellation baseline"],
  };
}

function answerProducts(s: OperationsSnapshot) {
  return {
    answer: `${s.products.top[0]?.name ?? "—"} is the best seller this week. The bottom of the menu is worth reviewing for simplification.`,
    bullets: [
      ...s.products.top.slice(0, 5).map((p, i) => `#${i + 1} ${p.name}: ${p.quantity} sold · ${formatAED(p.revenue)} · ${p.marginPct.toFixed(0)}% food margin`),
      ...s.products.bottom.slice(0, 3).map((p) => `Low: ${p.name} — ${p.quantity} sold · ${formatAED(p.revenue)}`),
    ],
    sources: ["Product performance · last 7 days"],
  };
}

function answerChannels(s: OperationsSnapshot) {
  const ranked = [...s.channels].sort((a, b) => b.revenueToday - a.revenueToday);
  return {
    answer: `${ranked[0].name} is the largest channel today (${formatAED(ranked[0].revenueToday)}). ${Math.round(s.concentration.shareOfDeliveryPct)}% of delivery-platform revenue comes from ${s.channels.find((c) => c.channel === s.concentration.topMarketplace)?.name ?? "one platform"}.`,
    bullets: ranked.map(
      (c) => `${c.name}: ${formatAED(c.revenueToday)} · ${c.ordersToday} orders · AOV ${formatAED(c.aovToday)} · ${c.status}`,
    ),
    sources: ["Revenue by channel today", "Channel health"],
  };
}

function answerSummary(s: OperationsSnapshot) {
  const b = buildBriefing(s);
  return {
    answer: b.headline,
    bullets: [...b.briefing, ...b.risks].slice(0, 6).map((i) => i.text),
    sources: ["Daily briefing"],
  };
}

const FOLLOW_UPS: Record<Intent, string[]> = {
  revenue: ["Which delivery platform is most profitable?", "Which location is performing best?"],
  location: ["Where are our operational bottlenecks?", "Why did revenue drop today?"],
  profit: ["Which location is performing best?", "Why did revenue drop today?"],
  stock: ["Where are our operational bottlenecks?", "Which delivery platform is most profitable?"],
  bottleneck: ["What items are likely to run out tonight?", "Which location is performing best?"],
  cancellations: ["Where are our operational bottlenecks?", "Which delivery platform is most profitable?"],
  products: ["What items are likely to run out tonight?", "Which delivery platform is most profitable?"],
  channels: ["Which delivery platform is most profitable?", "Why did revenue drop today?"],
  summary: ["Why did revenue drop today?", "Where are our operational bottlenecks?"],
};

/**
 * Rule-based analyst over the OperationsSnapshot. Deterministic, instant and
 * free — and every number it quotes is traceable to CornerOps data.
 */
export const deterministicProvider: OperationsAIProvider = {
  id: "deterministic",
  label: "CornerOps Analyst (rule-based)",
  kind: "deterministic",
  async answer(question, snapshot): Promise<AIAnswer> {
    const intent = detectIntent(question);
    const handlers: Record<Intent, (s: OperationsSnapshot, q: string) => { answer: string; bullets: string[]; sources: string[] }> = {
      revenue: answerRevenue,
      location: answerLocation,
      profit: answerProfit,
      stock: answerStock,
      bottleneck: answerBottleneck,
      cancellations: answerCancellations,
      products: answerProducts,
      channels: answerChannels,
      summary: answerSummary,
    };
    const res = handlers[intent](snapshot, question);
    return {
      question,
      ...res,
      followUps: FOLLOW_UPS[intent],
      provider: this.label,
      generatedAt: snapshot.generatedAt,
    };
  },
};
