"use client";

import { ChefHat, Clock, Crosshair, MapPin, User } from "lucide-react";
import Link from "next/link";
import { ChannelMark } from "@/components/shared/channel-badge";
import { Delta } from "@/components/shared/delta";
import { PageHeader } from "@/components/shared/page-header";
import { ConnectionDot, SeverityIcon } from "@/components/shared/status";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { useLocations } from "@/hooks/queries";
import { useLocationScope } from "@/hooks/use-location-scope";
import { useSession } from "@/hooks/use-session";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatMinutes, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS = {
  operational: { label: "Operational", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  busy: { label: "Busy", cls: "bg-amber-50 text-amber-800 ring-amber-500/30" },
  attention: { label: "Needs attention", cls: "bg-red-50 text-red-700 ring-red-600/25" },
} as const;

export function LocationsView() {
  const { data, isLoading, error, refetch } = useLocations();
  const { scope, setScope } = useLocationScope();
  const session = useSession();

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Locations"
        description={`${session.organization.name} · ${data.length} location${data.length === 1 ? "" : "s"} you can access. Pick one to scope the workspace, or stay on All locations.`}
        actions={
          scope !== "all" ? (
            <Button size="sm" variant="outline" className="bg-card" onClick={() => setScope("all")}>
              Back to all locations
            </Button>
          ) : null
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {data.map((l) => {
          const st = STATUS[l.status];
          const prepDrift = l.avgPrepMinutes && l.baselinePrepMinutes ? ((l.avgPrepMinutes - l.baselinePrepMinutes) / l.baselinePrepMinutes) * 100 : null;
          return (
            <section key={l.id} className={cn("flex flex-col rounded-xl bg-card ring-1 ring-foreground/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.03)]", scope === l.id && "ring-2 ring-foreground/60")}>
              <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">{l.name}</h2>
                    <span className="rounded bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">{l.code}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="size-3" /> {l.address}
                  </div>
                </div>
                <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", st.cls)}>{st.label}</span>
              </header>

              <dl className="grid grid-cols-3 gap-px bg-border/60 text-sm">
                <Metric label="Revenue today" value={formatAED(l.revenueToday)} extra={<Delta value={l.revenueDeltaPct} />} />
                <Metric label="Orders today" value={l.ordersToday} extra={<span className="text-[11px] text-muted-foreground">AOV {formatAED(l.aov)}</span>} />
                <Metric
                  label="Active now"
                  value={l.activeOrders}
                  extra={l.delayedOrders ? <span className="text-[11px] font-medium text-red-600">{l.delayedOrders} late</span> : <span className="text-[11px] text-muted-foreground">on track</span>}
                />
                <Metric label="Prep time today" value={formatMinutes(l.avgPrepMinutes)} extra={<Delta value={prepDrift} goodWhen="down" suffix="vs 7d" />} />
                <Metric label="Last hour prep" value={formatMinutes(l.lastHourPrepMinutes)} />
                <Metric label="Cancellation" value={formatPercent(l.cancellationRate)} />
              </dl>

              <div className="space-y-3 px-4 py-3 text-sm">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Kitchen load</span>
                    <span className="font-medium tabular">
                      {l.kitchenLoadPct}% of {l.kitchenCapacity} tickets
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", l.kitchenLoadPct >= 85 ? "bg-critical" : l.kitchenLoadPct >= 60 ? "bg-warning" : "bg-good")} style={{ width: `${Math.min(100, l.kitchenLoadPct)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-xs text-muted-foreground">Connected channels</div>
                  <div className="flex flex-wrap gap-1.5">
                    {l.connections.map((c) => (
                      <span key={c.channel} className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px]" title={`${CHANNEL_THEME[c.channel].label}: ${c.status}`}>
                        <ChannelMark channel={c.channel} size="xs" />
                        {CHANNEL_THEME[c.channel].short}
                        <ConnectionDot status={c.status} />
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" /> {l.operatingHours.open}–{l.operatingHours.close}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <User className="size-3" /> {l.managerName}
                  </span>
                  <span>
                    Inventory: {l.inventoryAlerts.out ? <span className="font-medium text-red-600">{l.inventoryAlerts.out} out</span> : "0 out"}, {l.inventoryAlerts.critical} critical, {l.inventoryAlerts.low} low
                  </span>
                </div>
                {l.alerts.length ? (
                  <ul className="space-y-1.5 rounded-lg bg-muted/50 p-2.5">
                    {l.alerts.map((a) => (
                      <li key={a.id} className="flex gap-2 text-xs">
                        <SeverityIcon severity={a.severity} className="size-3.5" />
                        <Link href={a.href} className="hover:underline">
                          {a.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <footer className="mt-auto flex items-center gap-2 border-t px-4 py-2.5">
                <Button size="sm" variant={scope === l.id ? "secondary" : "outline"} className={scope === l.id ? "" : "bg-card"} onClick={() => setScope(l.id)}>
                  <Crosshair /> {scope === l.id ? "In focus" : "Focus workspace"}
                </Button>
                <Link href={`/kitchen?location=${l.id}`} className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}>
                  <ChefHat /> Kitchen
                </Link>
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value, extra }: { label: string; value: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular">{value}</dd>
      {extra ? <div className="mt-0.5">{extra}</div> : null}
    </div>
  );
}
