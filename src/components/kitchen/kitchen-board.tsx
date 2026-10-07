"use client";

import { AlertOctagon, AlertTriangle, ChefHat, CircleCheck, Clock, Flame, Maximize2, Minimize2, Store } from "lucide-react";
import Link from "next/link";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { ErrorState } from "@/components/shared/states";
import { ElapsedTimer, RelativeTime } from "@/components/shared/time";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SlaLevel, SlaSettings } from "@/domain/orders/sla";
import { primaryAction, TRANSITIONS } from "@/domain/orders/state-machine";
import type { UnifiedOrder } from "@/domain/orders/types";
import { useKitchen, useLocationDirectory, useLocationName, useOrderAction } from "@/hooks/queries";
import { useLocationScope } from "@/hooks/use-location-scope";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { phaseStart, useSla } from "@/components/orders/order-card";

const COLUMNS = [
  { key: "new", title: "New", statuses: ["new", "accepted"], hint: "Accept & fire" },
  { key: "preparing", title: "Preparing", statuses: ["preparing"], hint: "On the line" },
  { key: "ready", title: "Ready", statuses: ["ready"], hint: "Awaiting pickup" },
] as const;

const PRIORITY: Record<SlaLevel, { label: string; Icon: typeof Clock; cls: string; bar: string }> = {
  normal: { label: "NORMAL", Icon: Clock, cls: "text-zinc-600 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300", bar: "bg-zinc-300 dark:bg-zinc-600" },
  warning: { label: "WARNING", Icon: AlertTriangle, cls: "text-amber-900 bg-amber-100 dark:bg-amber-400/20 dark:text-amber-300", bar: "bg-warning" },
  critical: { label: "CRITICAL", Icon: AlertOctagon, cls: "text-white bg-red-600", bar: "bg-critical" },
};

export function KitchenBoard({ display = false }: { display?: boolean }) {
  const { data, isLoading, error, refetch } = useKitchen();
  const { scope, setScope } = useLocationScope();
  const { data: locations } = useLocationDirectory();
  const locationName = useLocationName();

  return (
    <div className={cn(display && "dark min-h-dvh bg-zinc-950 p-4 text-zinc-100 sm:p-6")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ChefHat className={cn("size-6", display ? "text-zinc-400" : "text-muted-foreground")} />
          <div>
            <h1 className={cn("font-semibold tracking-tight", display ? "text-2xl" : "text-xl")}>Kitchen</h1>
            <p className={cn("text-sm", display ? "text-zinc-400" : "text-muted-foreground")}>
              {scope === "all" ? "All locations" : locationName(scope)} · every channel, one line
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={cn("flex rounded-lg border p-0.5", display ? "border-zinc-800 bg-zinc-900" : "bg-card")}>
            {[{ id: "all", name: "All" }, ...(locations ?? [])].map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setScope(l.id)}
                className={cn(
                  "h-8 rounded-md px-3 text-xs font-medium",
                  scope === l.id ? (display ? "bg-zinc-100 text-zinc-900" : "bg-foreground text-background") : display ? "text-zinc-400 hover:text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l.name}
              </button>
            ))}
          </div>
          {display ? (
            <Link href="/kitchen" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-white")}>
              <Minimize2 /> Exit display
            </Link>
          ) : (
            <Link href="/kds" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "bg-card")}>
              <Maximize2 /> Kitchen display mode
            </Link>
          )}
        </div>
      </div>

      {data ? <Stats stats={data.stats} display={display} /> : null}

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:gap-4">
          {COLUMNS.map((c) => (
            <Skeleton key={c.key} className="h-96 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:gap-4">
          {COLUMNS.map((col) => {
            const tickets = data.tickets.filter((t) => (col.statuses as readonly string[]).includes(t.status));
            return (
              <section key={col.key} className={cn("flex min-h-[60vh] flex-col rounded-xl", display ? "bg-zinc-900/70" : "bg-muted/60")}>
                <header className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold uppercase tracking-[0.14em]">{col.title}</h2>
                    <span className={cn("rounded-full px-2 text-xs font-semibold leading-5 tabular", display ? "bg-zinc-800" : "bg-background")}>{tickets.length}</span>
                  </div>
                  <span className={cn("text-xs", display ? "text-zinc-500" : "text-muted-foreground")}>{col.hint}</span>
                </header>
                <div className="flex flex-1 flex-col gap-3 px-2.5 pb-3">
                  {tickets.length === 0 ? (
                    <div className={cn("flex flex-1 items-center justify-center rounded-lg border border-dashed text-sm", display ? "border-zinc-800 text-zinc-600" : "text-muted-foreground")}>
                      No tickets
                    </div>
                  ) : (
                    tickets.map((t) => (
                      <Ticket key={t.id} order={t} sla={data.sla} display={display} showLocation={scope === "all"} locationName={locationName(t.locationId)} />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {data?.recentlyBumped.length ? (
        <div className={cn("mt-4 flex flex-wrap items-center gap-2 text-xs", display ? "text-zinc-500" : "text-muted-foreground")}>
          <CircleCheck className="size-3.5" /> Recently picked up:
          {data.recentlyBumped.map((o) => (
            <span key={o.id} className={cn("rounded-md px-2 py-0.5 font-mono", display ? "bg-zinc-900" : "bg-muted")}>
              #{o.orderNumber.replace("CO-", "")} <RelativeTime iso={o.pickedUpAt} />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Stats({ stats, display }: { stats: NonNullable<ReturnType<typeof useKitchen>["data"]>["stats"]; display: boolean }) {
  const items = [
    { label: "Open tickets", value: stats.inQueue },
    { label: "At risk", value: stats.warning, tone: stats.warning ? "warning" : undefined },
    { label: "Late", value: stats.critical, tone: stats.critical ? "critical" : undefined },
    { label: "Avg prep (last hour)", value: formatMinutes(stats.avgPrepLastHour) },
    { label: "Ready last hour", value: stats.completedLastHour },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className={cn("rounded-lg px-3 py-2", display ? "bg-zinc-900" : "bg-card ring-1 ring-foreground/[0.08]")}>
          <div className={cn("text-[11px] font-medium", display ? "text-zinc-500" : "text-muted-foreground")}>{i.label}</div>
          <div className={cn("text-xl font-semibold tabular", i.tone === "critical" && "text-red-500", i.tone === "warning" && "text-amber-500")}>{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function Ticket({
  order,
  sla,
  display,
  showLocation,
  locationName,
}: {
  order: UnifiedOrder;
  sla: SlaSettings;
  display: boolean;
  showLocation: boolean;
  locationName: string;
}) {
  const state = useSla(order, sla);
  const level = state?.level ?? "normal";
  const p = PRIORITY[level];
  const mutation = useOrderAction();
  const kitchenAction = primaryAction(order);

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-xl shadow-sm",
        display ? "bg-zinc-800/90 ring-1 ring-zinc-700" : "bg-card ring-1 ring-foreground/10",
        level === "critical" && "ring-2 ring-red-500 animate-critical",
        level === "warning" && "ring-2 ring-amber-400",
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1.5", p.bar)} aria-hidden />
      <div className="py-3 pr-3 pl-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-xl font-bold">#{order.orderNumber.replace("CO-", "")}</span>
            <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", display ? "text-zinc-400" : "text-muted-foreground")}>
              <ChannelBadge channel={order.channel} short size="xs" className={display ? "text-zinc-200" : "text-foreground"} />
              <span>{order.fulfillment === "pickup" ? "Pickup" : "Delivery"}</span>
              {order.status === "accepted" ? <span className="rounded bg-violet-600 px-1.5 text-[10px] font-bold text-white">ACCEPTED</span> : null}
              {showLocation ? (
                <span className="inline-flex items-center gap-1">
                  <Store className="size-3" /> {locationName}
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className={cn("font-mono text-2xl font-bold tabular leading-none", level === "critical" && "text-red-500", level === "warning" && "text-amber-500")}>
              <ElapsedTimer since={phaseStart(order)} />
            </div>
            <span className={cn("mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider", p.cls)}>
              <p.Icon className="size-3" aria-hidden />
              {p.label}
            </span>
          </div>
        </div>

        <ul className="mt-3 space-y-1.5">
          {order.items.map((l) => (
            <li key={l.id} className="flex gap-2.5">
              <span className={cn("flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-sm font-bold tabular", display ? "bg-zinc-700" : "bg-muted")}>{l.quantity}</span>
              <div className="min-w-0">
                <div className="text-[15px] leading-6 font-semibold">{l.name}</div>
                {l.modifiers.map((m) => (
                  <div key={m.name} className={cn("text-[13px] font-medium", m.name.startsWith("No ") ? "text-red-500" : display ? "text-amber-300" : "text-amber-700")}>
                    {m.name.startsWith("No ") ? "✕ " : "+ "}
                    {m.name}
                  </div>
                ))}
                {l.notes ? <div className="text-[13px] italic text-amber-600">“{l.notes}”</div> : null}
              </div>
            </li>
          ))}
        </ul>
        {order.notes ? (
          <div className={cn("mt-2 flex gap-1.5 rounded-md px-2 py-1 text-xs", display ? "bg-amber-400/10 text-amber-200" : "bg-amber-50 text-amber-900")}>
            <Flame className="mt-0.5 size-3 shrink-0" /> {order.notes}
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          {kitchenAction ? (
            <Button
              size="lg"
              className={cn(
                "h-11 flex-1 text-sm font-bold",
                kitchenAction === "accept" && "bg-blue-600 text-white hover:bg-blue-700",
                kitchenAction === "start_preparing" && "bg-amber-500 text-white hover:bg-amber-600",
                kitchenAction === "mark_ready" && "bg-emerald-600 text-white hover:bg-emerald-700",
                kitchenAction === "mark_picked_up" && "bg-sky-600 text-white hover:bg-sky-700",
              )}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ order, action: kitchenAction })}
            >
              {TRANSITIONS[kitchenAction].label}
            </Button>
          ) : null}
          {order.status === "accepted" || order.status === "new" ? null : (
            <span className={cn("text-[11px]", display ? "text-zinc-500" : "text-muted-foreground")}>
              target {Math.round((state?.targetMs ?? 0) / 60000)}m
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
