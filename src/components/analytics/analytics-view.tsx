"use client";

import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ChannelBarList, ShareBar, SimpleBars, TrendChart } from "@/components/analytics/charts";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { Delta } from "@/components/shared/delta";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import type { AnalyticsRange } from "@/domain/analytics/range";
import { useAnalytics } from "@/hooks/queries";
import { useSession } from "@/hooks/use-session";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatDay, formatMinutes, formatNumber, formatPercent, formatWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";

export const RANGE_OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

export function RangePicker({ value, onChange }: { value: AnalyticsRange; onChange: (r: AnalyticsRange) => void }) {
  return (
    <div className="flex rounded-lg border bg-card p-0.5" role="tablist" aria-label="Date range">
      {RANGE_OPTIONS.map((r) => (
        <button
          key={r.value}
          type="button"
          role="tab"
          aria-selected={value === r.value}
          onClick={() => onChange(r.value)}
          className={cn("h-7 whitespace-nowrap rounded-md px-3 text-xs font-medium", value === r.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function AnalyticsView({ initialRange }: { initialRange: AnalyticsRange }) {
  const [range, setRange] = useState<AnalyticsRange>(initialRange);
  const { data, isLoading, error, refetch } = useAnalytics(range);
  const session = useSession();
  const canProfit = session.permissions.includes("profitability.view");

  const header = (
    <PageHeader
      title="Analytics"
      description="Revenue, channels, locations and products — one consistent definition across every platform."
      actions={<RangePicker value={range} onChange={setRange} />}
    />
  );
  if (error) return (<>{header}<ErrorState error={error} onRetry={() => refetch()} /></>);
  if (isLoading || !data) return (<>{header}<PageSkeleton /></>);

  const s = data.summary;
  const trend = data.trend.map((b) => ({ ...b, label: data.bucket === "hour" ? b.key : formatWeekday(b.ts + 12 * 3600_000) }));
  const peak = Math.max(...data.hourProfile.map((h) => h.orders));
  const hourData = data.hourProfile.filter((h) => h.hour >= 10 || h.hour <= 1).sort((a, b) => ((a.hour + 14) % 24) - ((b.hour + 14) % 24)).map((h) => ({ ...h, label: `${h.hour.toString().padStart(2, "0")}h` }));
  const conc = data.concentration;
  const topName = conc.topMarketplace ? CHANNEL_THEME[conc.topMarketplace].label : "—";

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.revenueCards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setRange(c.key as AnalyticsRange)}
            className={cn("rounded-xl bg-card p-3.5 text-left ring-1 ring-foreground/[0.08] transition-shadow hover:ring-foreground/20", range === c.key && "ring-2 ring-foreground/60")}
          >
            <div className="text-xs font-medium text-muted-foreground">Revenue · {c.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight tabular">{formatAED(c.value ?? 0)}</div>
            <div className="mt-1 flex items-center gap-1.5">
              <Delta value={c.deltaPct} />
              <span className="truncate text-xs text-muted-foreground">{c.comparisonLabel}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={`Orders · ${data.label}`} value={formatNumber(s.orders.value ?? 0)} delta={s.orders.deltaPct} comparison={data.comparisonLabel} />
        <KpiCard label="Average order value" value={formatAED(s.aov.value ?? 0)} delta={s.aov.deltaPct} comparison={data.comparisonLabel} />
        <KpiCard label="Avg preparation time" value={formatMinutes(s.avgPrepMinutes.value)} delta={s.avgPrepMinutes.deltaPct} goodWhen="down" comparison={data.comparisonLabel} />
        <KpiCard label="Cancellation rate" value={formatPercent(s.cancellationRate.value ?? 0)} delta={s.cancellationRate.deltaPct} goodWhen="down" comparison={data.comparisonLabel} />
      </div>

      <Panel title={`Revenue · ${data.label}`} description={data.bucket === "hour" ? "Net food sales by hour (Dubai time)" : "Net food sales by day"}>
        <TrendChart data={trend} xKey="label" currentLabel={data.label} previousLabel={s.revenue.previous !== null ? "Previous period" : undefined} height={260} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Channel comparison" description={`${data.label} · ${data.comparisonLabel}`} bodyClassName="p-0">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                  <th className="px-3 py-2 text-right font-medium">Orders</th>
                  <th className="px-3 py-2 text-right font-medium">AOV</th>
                  <th className="px-3 py-2 text-right font-medium">Prep</th>
                  <th className="px-3 py-2 text-right font-medium">Cancel %</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...data.byChannel].sort((a, b) => b.revenue - a.revenue).map((c) => (
                  <tr key={c.channel}>
                    <td className="px-4 py-2">
                      <ChannelBadge channel={c.channel} size="xs" />
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular">{formatAED(c.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">{formatPercent(c.share)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatNumber(c.orders)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatAED(c.aov)}</td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">{formatMinutes(c.avgPrepMinutes)}</td>
                    <td className={cn("px-3 py-2 text-right tabular", c.cancellationRate > 5 ? "font-medium text-red-600" : "text-muted-foreground")}>{formatPercent(c.cancellationRate)}</td>
                    <td className="px-3 py-2 text-right">
                      <Delta value={c.revenueDeltaPct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="xl:col-span-2" title="Marketplace concentration" description="How dependent the business is on each platform">
          <div className="mb-4 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
            <span className="font-semibold">{Math.round(conc.topMarketplaceShareOfDeliveryPct)}%</span> of {session.organization.name}&apos;s delivery-platform revenue currently depends on{" "}
            <span className="font-semibold">{topName}</span>. Marketplaces carry {formatPercent(conc.marketplaceSharePct, 0)} of all revenue; owned channels{" "}
            {formatPercent(conc.ownedSharePct, 0)}.
          </div>
          <ShareBar rows={data.byChannel.map((c) => ({ channel: c.channel, share: c.share }))} />
          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" /> Concentration index (HHI) {conc.hhi.toFixed(2)} — {conc.level}. Above 0.25 means a single platform change can
            materially move revenue.
          </p>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Revenue by location" description={data.label}>
          <ul className="space-y-3">
            {data.byLocation.map((l) => {
              const max = Math.max(...data.byLocation.map((x) => x.revenue), 1);
              return (
                <li key={l.locationId}>
                  <div className="mb-1 flex items-center justify-between text-[13px]">
                    <span className="font-medium">{l.name}</span>
                    <span className="flex items-center gap-2">
                      <Delta value={l.revenueDeltaPct} />
                      <span className="font-semibold tabular">{formatAED(l.revenue)}</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${(l.revenue / max) * 100}%` }} />
                  </div>
                  <div className="mt-1 flex gap-3 text-[11px] text-muted-foreground">
                    <span>{formatNumber(l.orders)} orders</span>
                    <span>AOV {formatAED(l.aov)}</span>
                    <span>Prep {formatMinutes(l.avgPrepMinutes)}</span>
                    <span>Cancel {formatPercent(l.cancellationRate)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="xl:col-span-2" title="Order volume by hour" description={`Average orders per hour, ${data.label.toLowerCase()} · darker bars are peak hours`}>
          <SimpleBars data={hourData} xKey="label" yKey="orders" name="Orders / hour" format={(v) => v.toFixed(v < 10 ? 1 : 0)} highlight={(d) => Number(d.orders) >= peak * 0.7} height={220} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Top products" description={`By net revenue · ${data.label}`} bodyClassName="p-0">
          <ProductTable rows={data.topProducts} />
        </Panel>
        <Panel title="Bottom products" description="Candidates for review or menu simplification" bodyClassName="p-0">
          <ProductTable rows={data.bottomProducts} compact />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Revenue by channel" description={data.label}>
          <ChannelBarList rows={[...data.byChannel].sort((a, b) => b.revenue - a.revenue).map((c) => ({ channel: c.channel, value: c.revenue }))} secondary={(r) => `${formatNumber(data.byChannel.find((c) => c.channel === r.channel)?.orders ?? 0)} orders`} />
        </Panel>
        {canProfit ? (
        <Link
          href="/profitability"
          className="group flex flex-col justify-between rounded-xl bg-[#141417] p-5 text-white ring-1 ring-black/10 transition-transform hover:-translate-y-0.5"
        >
          <div>
            <div className="text-xs font-medium text-white/50">Profitability</div>
            <div className="mt-2 text-lg font-semibold leading-snug">Revenue isn&apos;t profit. See which platform actually makes you money.</div>
          </div>
          <div className="mt-4 flex items-center gap-1 text-sm font-medium text-white/80 group-hover:text-white">
            Estimated contribution margin by channel <ArrowRight className="size-4" />
          </div>
        </Link>
        ) : null}
      </div>
      {data.firstOrderAt ? (
        <p className="text-[11px] text-muted-foreground">
          {formatNumber(data.orderCount)} orders analysed since {formatDay(data.firstOrderAt)}. Revenue = net food sales after discounts, excluding VAT & delivery fees.
        </p>
      ) : null}
    </div>
  );
}

function ProductTable({ rows, compact }: { rows: { menuItemId: string; name: string; quantity: number; revenue: number; marginPct?: number }[]; compact?: boolean }) {
  const showMargin = rows.some((p) => p.marginPct !== undefined);
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2 font-medium">Product</th>
          <th className="px-3 py-2 text-right font-medium">Sold</th>
          <th className="px-3 py-2 text-right font-medium">Revenue</th>
          {!compact && showMargin ? <th className="px-4 py-2 text-right font-medium">Food margin</th> : null}
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((p, i) => (
          <tr key={p.menuItemId}>
            <td className="px-4 py-2">
              <span className="mr-2 inline-block w-4 text-xs text-muted-foreground tabular">{i + 1}</span>
              {p.name}
            </td>
            <td className="px-3 py-2 text-right tabular">{formatNumber(p.quantity)}</td>
            <td className="px-3 py-2 text-right font-medium tabular">{formatAED(p.revenue)}</td>
            {!compact && showMargin ? <td className="px-4 py-2 text-right tabular text-muted-foreground">{p.marginPct !== undefined ? formatPercent(p.marginPct, 0) : "—"}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
