"use client";

import { Crown, Info, Settings2, TrendingDown, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ChannelBadge, ChannelMark } from "@/components/shared/channel-badge";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import type { AnalyticsRange } from "@/domain/analytics/range";
import type { OrderChannel } from "@/domain/channels/types";
import { useProfitability } from "@/hooks/queries";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RangePicker } from "./analytics-view";

const SEGMENTS = [
  { key: "foodCost", label: "Food cost", color: "#57534e" },
  { key: "commission", label: "Platform commission", color: "#a8a29e" },
  { key: "discounts", label: "Discounts (restaurant-funded)", color: "#d6d3d1" },
  { key: "deliveryAndServiceFees", label: "Delivery & payment fees", color: "#e7e5e4" },
  { key: "contribution", label: "Contribution", color: "#2a78d6" },
] as const;

export function ProfitabilityView({ initialRange }: { initialRange: AnalyticsRange }) {
  const [range, setRange] = useState<AnalyticsRange>(initialRange);
  const { data, isLoading, error, refetch } = useProfitability(range);

  const header = (
    <PageHeader
      title="Profitability"
      description="Estimated contribution margin by channel — which platform actually makes you money."
      actions={<RangePicker value={range} onChange={setRange} />}
    />
  );
  if (error) return (<>{header}<ErrorState error={error} onRetry={() => refetch()} /></>);
  if (isLoading || !data) return (<>{header}<PageSkeleton /></>);

  const { rows, totals, bestMargin, worstMargin, topContributor } = data;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {bestMargin ? (
          <HeadlineCard
            icon={Crown}
            tone="positive"
            label="Best margin"
            channel={bestMargin.channel}
            value={`${formatPercent(bestMargin.marginPct, 0)} of sales kept`}
            detail={`${formatAED(bestMargin.contributionPerOrder)} contribution per order`}
          />
        ) : null}
        {topContributor ? (
          <HeadlineCard
            icon={Wallet}
            tone="neutral"
            label="Largest profit pool"
            channel={topContributor.channel}
            value={`${formatAED(topContributor.contribution)} contribution`}
            detail={`${formatPercent(totals.contribution ? (topContributor.contribution / totals.contribution) * 100 : 0, 0)} of total · ${formatNumber(topContributor.orders)} orders`}
          />
        ) : null}
        {worstMargin ? (
          <HeadlineCard
            icon={TrendingDown}
            tone="negative"
            label="Thinnest margin"
            channel={worstMargin.channel}
            value={`${formatPercent(worstMargin.marginPct, 0)} of sales kept`}
            detail={`Commission + discounts cost ${formatAED(worstMargin.commission + worstMargin.discounts)}`}
          />
        ) : null}
      </div>

      <Panel title="Where every AED goes" description={`Share of gross food sales by channel · ${data.label}`}>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </div>
        <ul className="space-y-3">
          {[...rows].sort((a, b) => b.marginPct - a.marginPct).map((r) => (
            <li key={r.channel} className="grid grid-cols-[120px_1fr_64px] items-center gap-3 sm:grid-cols-[150px_1fr_72px]">
              <ChannelBadge channel={r.channel} short className="text-[13px]" />
              <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-md">
                {SEGMENTS.map((s) => {
                  const v = Math.max(0, r[s.key]);
                  const pct = r.grossSales ? (v / r.grossSales) * 100 : 0;
                  if (pct <= 0) return null;
                  return (
                    <div
                      key={s.key}
                      className="flex items-center justify-center text-[10px] font-medium"
                      style={{ width: `${pct}%`, background: s.color, color: s.key === "contribution" || s.key === "foodCost" ? "white" : "#44403c" }}
                      title={`${s.label}: ${formatAED(v)} (${pct.toFixed(1)}%)`}
                    >
                      {pct >= 9 ? `${pct.toFixed(0)}%` : ""}
                    </div>
                  );
                })}
              </div>
              <div className="text-right text-sm font-semibold tabular">{formatPercent(r.marginPct, 0)}</div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Channel economics" description={`${data.label} · all figures estimated from order data and contract terms`} bodyClassName="p-0">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Gross sales</th>
                <th className="px-3 py-2 text-right font-medium">Discounts</th>
                <th className="px-3 py-2 text-right font-medium">Platform commission</th>
                <th className="px-3 py-2 text-right font-medium">Delivery / service fees</th>
                <th className="px-3 py-2 text-right font-medium">Food cost</th>
                <th className="px-3 py-2 text-right font-medium">Est. contribution</th>
                <th className="px-3 py-2 text-right font-medium">Margin</th>
                <th className="px-4 py-2 text-right font-medium">Per order</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.channel}>
                  <td className="px-4 py-2.5">
                    <ChannelBadge channel={r.channel} size="xs" />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{formatNumber(r.orders)}</td>
                  <td className="px-3 py-2.5 text-right font-medium tabular">{formatAED(r.grossSales)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-muted-foreground">−{formatAED(r.discounts)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-muted-foreground">−{formatAED(r.commission)}</td>
                  <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                    {r.deliveryAndServiceFees < 0 ? "+" : "−"}
                    {formatAED(Math.abs(r.deliveryAndServiceFees))}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular text-muted-foreground">−{formatAED(r.foodCost)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular">{formatAED(r.contribution)}</td>
                  <td className={cn("px-3 py-2.5 text-right font-medium tabular", r === bestMargin && "text-emerald-700", r === worstMargin && "text-red-600")}>{formatPercent(r.marginPct)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{formatAED(r.contributionPerOrder)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-4 py-2.5">All channels</td>
                <td className="px-3 py-2.5 text-right tabular">{formatNumber(totals.orders)}</td>
                <td className="px-3 py-2.5 text-right tabular">{formatAED(totals.grossSales)}</td>
                <td className="px-3 py-2.5 text-right tabular">−{formatAED(totals.discounts)}</td>
                <td className="px-3 py-2.5 text-right tabular">−{formatAED(totals.commission)}</td>
                <td className="px-3 py-2.5 text-right tabular">−{formatAED(totals.deliveryAndServiceFees)}</td>
                <td className="px-3 py-2.5 text-right tabular">−{formatAED(totals.foodCost)}</td>
                <td className="px-3 py-2.5 text-right tabular">{formatAED(totals.contribution)}</td>
                <td className="px-3 py-2.5 text-right tabular">{formatPercent(totals.marginPct)}</td>
                <td className="px-4 py-2.5 text-right tabular">{formatAED(totals.contributionPerOrder)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Contribution by location" description={data.label}>
          <ul className="divide-y">
            {data.byLocation.map((l) => (
              <li key={l.locationId} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">{l.name}</span>
                <span className="flex items-center gap-4 tabular">
                  <span className="text-xs text-muted-foreground">{formatAED(l.grossSales)} gross</span>
                  <span className="font-semibold">{formatAED(l.contribution)}</span>
                  <span className="w-14 text-right text-muted-foreground">{formatPercent(l.marginPct, 0)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel
          title="Commercial terms used"
          description="Assumptions behind the estimates"
          action={
            <Link href="/settings#economics" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              <Settings2 className="size-3.5" /> Edit
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="relative overflow-x-auto">
          <table className="w-full min-w-[440px] text-xs">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 text-right font-medium">Commission</th>
                <th className="px-3 py-2 text-right font-medium">Payment fee</th>
                <th className="px-3 py-2 text-right font-medium">Discount funded by you</th>
                <th className="px-4 py-2 text-right font-medium">Delivery cost</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(Object.keys(data.economics) as OrderChannel[]).map((ch) => {
                const e = data.economics[ch];
                return (
                  <tr key={ch}>
                    <td className="px-4 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <ChannelMark channel={ch} size="xs" /> {CHANNEL_THEME[ch].short}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{formatPercent(e.commissionRate * 100, 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{formatPercent(e.paymentFeeRate * 100)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{formatPercent(e.restaurantFundedDiscountShare * 100, 0)}</td>
                    <td className="px-4 py-1.5 text-right tabular">{e.deliveryCostPerOrder ? formatAED(e.deliveryCostPerOrder) : "Platform"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Panel>
      </div>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        Contribution = gross food sales − restaurant-funded discounts − platform commission − payment & own-delivery costs (net of delivery fees collected) − recipe
        food cost. Excludes labour, rent and marketing. Commission uses the platform-reported fee where available, otherwise the contract rate.
      </p>
    </div>
  );
}

function HeadlineCard({
  icon: Icon,
  tone,
  label,
  channel,
  value,
  detail,
}: {
  icon: typeof Crown;
  tone: "positive" | "negative" | "neutral";
  label: string;
  channel: OrderChannel;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/[0.08]">
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-600" : "text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <ChannelMark channel={channel} size="md" />
        <span className="text-lg font-semibold">{CHANNEL_THEME[channel].label}</span>
      </div>
      <div className="mt-1.5 text-sm font-medium tabular">{value}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
