"use client";

import {
  ArrowRight,
  Ban,
  ChefHat,
  CircleDollarSign,
  Clock,
  Flame,
  Gauge,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  TimerOff,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { ChannelBarList, TrendChart } from "@/components/analytics/charts";
import { ChannelBadge, ChannelMark } from "@/components/shared/channel-badge";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { ConnectionBadge, OrderStatusBadge, SeverityIcon } from "@/components/shared/status";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { RelativeTime } from "@/components/shared/time";
import { useLocationName, useOverview } from "@/hooks/queries";
import { useLocationScope } from "@/hooks/use-location-scope";
import { useSession } from "@/hooks/use-session";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatMinutes, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function OverviewView() {
  const { data, isLoading, error, refetch } = useOverview();
  const { scope, setScope } = useLocationScope();
  const locationName = useLocationName();
  const session = useSession();

  const header = (
    <PageHeader
      title="Command Center"
      description={
        <>
          {session.organization.name} · {scope === "all" ? "All locations" : locationName(scope)} · live across every channel
        </>
      }
      actions={
        data ? (
          <span className="text-xs text-muted-foreground">
            Updated <RelativeTime iso={data.generatedAt} />
          </span>
        ) : null
      }
    />
  );

  if (error) return (<>{header}<ErrorState error={error} onRetry={() => refetch()} /></>);
  if (isLoading || !data) return (<>{header}<PageSkeleton /></>);

  const k = data.kpis;
  const p = data.pipeline;
  const pipeline = [
    { key: "new", label: "New", value: p.new, icon: ReceiptText, href: "/orders?status=new", tone: p.new ? "text-blue-700" : "" },
    { key: "accepted", label: "Accepted", value: p.accepted, icon: PackageCheck, href: "/orders?status=accepted" },
    { key: "preparing", label: "Preparing", value: p.preparing, icon: ChefHat, href: "/orders?status=preparing" },
    { key: "ready", label: "Ready", value: p.ready, icon: ShoppingBag, href: "/orders?status=ready" },
    { key: "delayed", label: "Delayed", value: p.delayed, icon: TimerOff, href: "/orders?delayed=1", tone: p.delayed ? "text-red-600" : "" },
    { key: "cancelled", label: "Cancelled today", value: p.cancelled, icon: Ban, href: "/orders?status=cancelled&range=today" },
  ];

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Revenue today" icon={CircleDollarSign} value={formatAED(k.revenue.value ?? 0)} delta={k.revenue.deltaPct} comparison="vs same time yesterday" />
        <KpiCard label="Orders today" icon={ReceiptText} value={formatNumber(k.orders.value ?? 0)} delta={k.orders.deltaPct} />
        <KpiCard label="Average order value" icon={TrendingUp} value={formatAED(k.aov.value ?? 0)} delta={k.aov.deltaPct} />
        <KpiCard label="Active orders" icon={Flame} value={formatNumber(k.activeOrders.value ?? 0)} hint={p.delayed ? <span className="font-medium text-red-600">{p.delayed} delayed</span> : "all on track"} />
        <KpiCard label="Avg prep time" icon={Clock} value={formatMinutes(k.avgPrepMinutes.value)} delta={k.avgPrepMinutes.deltaPct} goodWhen="down" />
        <KpiCard label="Cancellation rate" icon={Ban} value={formatPercent(k.cancellationRate.value ?? 0)} delta={k.cancellationRate.deltaPct} goodWhen="down" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Live operations"
          description="Every channel, one pipeline"
          action={
            <Link href="/orders" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
              Open queue <ArrowRight className="size-3" />
            </Link>
          }
        >
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {pipeline.map((s) => (
              <Link key={s.key} href={s.href} className="group rounded-lg border bg-background/60 px-3 py-2.5 transition-colors hover:border-foreground/20 hover:bg-card">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <s.icon className="size-3.5" /> {s.label}
                </div>
                <div className={cn("mt-1 text-2xl font-semibold tabular", s.tone)}>{s.value}</div>
              </Link>
            ))}
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Latest orders</div>
            </div>
            <ul className="divide-y rounded-lg border">
              {data.recentOrders.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders?order=${o.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                    <ChannelMark channel={o.channel} size="xs" />
                    <span className="w-24 font-mono text-[13px] font-medium">#{o.orderNumber}</span>
                    <span className="hidden w-28 truncate text-muted-foreground sm:block">{locationName(o.locationId)}</span>
                    <OrderStatusBadge status={o.status} />
                    <span className="ml-auto font-medium tabular">{formatAED(o.total, { precise: true })}</span>
                    <RelativeTime iso={o.placedAt} className="hidden w-20 text-right text-xs text-muted-foreground sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Channel health" description="Integration status across locations" action={<Link href="/channels" className="text-xs font-medium text-muted-foreground hover:text-foreground">Manage</Link>}>
          <ul className="space-y-1">
            {data.channelHealth.filter((c) => c.covered).map((c) => (
              <li key={c.channel} className="flex items-center gap-2.5 rounded-md px-1 py-1.5">
                <ChannelBadge channel={c.channel} className="flex-1 text-[13px]" />
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  {c.ordersToday} orders · <RelativeTime iso={c.lastSyncAt} />
                </span>
                <ConnectionBadge status={c.status} />
              </li>
            ))}
          </ul>
          {data.channelHealth.find((c) => c.status !== "connected" && c.message) ? (
            <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              {CHANNEL_THEME[data.channelHealth.find((c) => c.status !== "connected")!.channel].label}:{" "}
              {data.channelHealth.find((c) => c.status !== "connected")!.message}
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Revenue today" description="Net food sales by hour, Dubai time">
          <TrendChart data={data.trend} currentLabel="Today" previousLabel="Yesterday" height={250} />
        </Panel>
        <Panel title="Revenue by channel" description="Today, all delivery & owned channels">
          <ChannelBarList
            rows={[...data.revenueByChannel].sort((a, b) => b.revenue - a.revenue).map((r) => ({ channel: r.channel, value: r.revenue, share: r.share }))}
            secondary={(r) => `${(r.share ?? 0).toFixed(0)}%`}
          />
          <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold tabular">{formatAED(data.revenueByChannel.reduce((s, r) => s + r.revenue, 0))}</span>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Locations" description="Operational health by branch" bodyClassName="p-0">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 text-right font-medium">Active</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Prep today</th>
                  <th className="px-3 py-2 font-medium">Kitchen load</th>
                  <th className="px-3 py-2 text-right font-medium">Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.locations.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setScope(l.id)} title={`Focus on ${l.name}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.orders} orders today</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">
                      {l.activeOrders}
                      {l.delayed ? <span className="ml-1 text-xs font-medium text-red-600">({l.delayed} late)</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular">{formatAED(l.revenue)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{formatMinutes(l.avgPrepMinutes)}</td>
                    <td className="px-3 py-2.5">
                      <LoadBar pct={l.kitchenLoadPct} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {l.alerts ? (
                        <span className={cn("inline-flex items-center gap-1 text-xs font-medium", l.criticalAlerts ? "text-red-600" : "text-amber-700")}>
                          <SeverityIcon severity={l.criticalAlerts ? "critical" : "warning"} className="size-3.5" />
                          {l.alerts}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Operational alerts" description={`${data.alertCount} open`} bodyClassName="p-0" action={session.permissions.includes("ai.view") ? <Link href="/ai" className="text-xs font-medium text-muted-foreground hover:text-foreground">AI briefing</Link> : null}>
          {data.alerts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No open alerts.</p>
          ) : (
            <ul className="divide-y">
              {data.alerts.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="flex gap-2.5 px-4 py-2.5 hover:bg-muted/40">
                    <SeverityIcon severity={a.severity} className="mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium leading-snug">{a.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.detail}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Gauge className="size-3" /> Revenue = net food sales (after discounts, before VAT and delivery fees). Comparisons are against the same time yesterday.
      </p>
    </div>
  );
}

function LoadBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, pct);
  const tone = pct >= 85 ? "bg-critical" : pct >= 60 ? "bg-warning" : "bg-good";
  const label = pct >= 85 ? "Saturated" : pct >= 60 ? "Busy" : "Normal";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs tabular text-muted-foreground">
        {pct}% · {label}
      </span>
    </div>
  );
}
