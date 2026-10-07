"use client";

import { LayoutGrid, List, Search, TimerOff, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { PageHeader } from "@/components/shared/page-header";
import { OrderStatusBadge, SlaBadge } from "@/components/shared/status";
import { EmptyState, ErrorState } from "@/components/shared/states";
import { ElapsedTimer, RelativeTime } from "@/components/shared/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ORDER_CHANNELS } from "@/domain/channels/types";
import { ORDER_STATUS_LABEL, type UnifiedOrder } from "@/domain/orders/types";
import { useLocationDirectory, useLocationName, useOrders } from "@/hooks/queries";
import { useLocationScope } from "@/hooks/use-location-scope";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED } from "@/lib/format";
import { parseOrderFilters } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { OrderActions } from "./order-actions";
import { OrderCard, phaseStart, useSla } from "./order-card";
import { OrderDetail } from "./order-detail";

const STATUS_TABS = ["active", "new", "accepted", "preparing", "ready", "picked_up", "completed", "cancelled", "all"] as const;
const RANGES = [
  { value: "live", label: "Live" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
];

export function OrdersView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo(() => parseOrderFilters((k) => params.get(k)), [params]);
  const { scope } = useLocationScope();
  const { data: locations } = useLocationDirectory();
  const locationName = useLocationName();
  const { data, isLoading, error, refetch } = useOrders(filters);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [search, setSearch] = useState(filters.q ?? "");
  const openId = params.get("order");

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? "") !== search) setParam({ q: search || null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts = data?.counts;
  const hasFilters = !!(filters.channel || filters.delayed || filters.q || filters.filterLocation);

  return (
    <div>
      <PageHeader
        title="Live Orders"
        description="One queue for Talabat, Deliveroo, Noon Food, Keeta, website and WhatsApp orders."
        actions={
          <div className="flex rounded-lg border bg-card p-0.5">
            <Button size="sm" variant={view === "cards" ? "secondary" : "ghost"} onClick={() => setView("cards")} aria-label="Card view">
              <LayoutGrid />
            </Button>
            <Button size="sm" variant={view === "table" ? "secondary" : "ghost"} onClick={() => setView("table")} aria-label="Table view">
              <List />
            </Button>
          </div>
        }
      />

      {/* Status tabs */}
      <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
        {STATUS_TABS.map((s) => {
          const active = filters.status === s;
          const count = counts ? counts[s] : undefined;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setParam({ status: s })}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
                active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {s === "active" ? "Active" : s === "all" ? "All" : ORDER_STATUS_LABEL[s]}
              {count !== undefined ? (
                <span className={cn("rounded-full px-1.5 text-[10px] tabular leading-4", active ? "bg-background/20" : "bg-muted")}>{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order ID, platform ID, customer, item" className="h-8 bg-card pl-8" />
        </div>
        <FilterSelect
          label="Channel"
          value={filters.channel ?? ""}
          onChange={(v) => setParam({ channel: v })}
          options={[{ value: "", label: "All channels" }, ...ORDER_CHANNELS.map((c) => ({ value: c, label: CHANNEL_THEME[c].label }))]}
        />
        {scope === "all" ? (
          <FilterSelect
            label="Location"
            value={filters.filterLocation ?? ""}
            onChange={(v) => setParam({ filterLocation: v })}
            options={[{ value: "", label: "All locations" }, ...(locations ?? []).map((l) => ({ value: l.id, label: l.name }))]}
          />
        ) : null}
        <div className="flex rounded-lg border bg-card p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setParam({ range: r.value, status: r.value === "live" ? "active" : "all" })}
              className={cn("h-7 rounded-md px-2.5 text-xs font-medium", filters.range === r.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant={filters.delayed ? "default" : "outline"}
          className={cn(!filters.delayed && "bg-card", filters.delayed && "bg-red-600 hover:bg-red-700")}
          onClick={() => setParam({ delayed: filters.delayed ? null : "1" })}
        >
          <TimerOff /> Delayed only{counts ? ` (${counts.delayed})` : ""}
        </Button>
        {hasFilters ? (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setParam({ channel: null, delayed: null, q: null, filterLocation: null }); }}>
            <X /> Clear
          </Button>
        ) : null}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : data.orders.length === 0 ? (
        <EmptyState
          title={filters.delayed ? "No delayed orders" : "No orders match these filters"}
          description={filters.status === "active" ? "The queue is clear. New orders from every channel appear here instantly." : "Try a different status, channel or time range."}
        />
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.orders.map((o) => (
            <OrderCard key={o.id} order={o} sla={data.sla} locationName={locationName(o.locationId)} onOpen={() => setParam({ order: o.id })} selected={openId === o.id} />
          ))}
        </div>
      ) : (
        <OrdersTable orders={data.orders} sla={data.sla} onOpen={(id) => setParam({ order: id })} />
      )}

      <Sheet open={!!openId} onOpenChange={(open) => !open && setParam({ order: null })}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-5 sm:max-w-2xl data-[side=right]:sm:max-w-2xl">
          <SheetTitle className="sr-only">Order detail</SheetTitle>
          {openId ? <OrderDetail orderId={openId} compact /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function OrdersTable({ orders, sla, onOpen }: { orders: UnifiedOrder[]; sla: NonNullable<ReturnType<typeof useOrders>["data"]>["sla"]; onOpen: (id: string) => void }) {
  const locationName = useLocationName();
  return (
    <div className="relative overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/[0.08]">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Order</th>
            <th className="px-3 py-2 font-medium">Channel</th>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Items</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 font-medium">Received</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Timer</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((o) => (
            <TableRow key={o.id} order={o} sla={sla} locationName={locationName(o.locationId)} onOpen={() => onOpen(o.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ order, sla, locationName, onOpen }: { order: UnifiedOrder; sla: Parameters<typeof useSla>[1]; locationName: string; onOpen: () => void }) {
  const state = useSla(order, sla);
  return (
    <tr className="cursor-pointer hover:bg-muted/40" onClick={onOpen}>
      <td className="px-3 py-2">
        <div className="font-mono text-[13px] font-semibold">#{order.orderNumber}</div>
        <div className="font-mono text-[11px] text-muted-foreground">{order.externalOrderId}</div>
      </td>
      <td className="px-3 py-2">
        <ChannelBadge channel={order.channel} short size="xs" />
      </td>
      <td className="px-3 py-2 text-muted-foreground">{locationName}</td>
      <td className="max-w-36 truncate px-3 py-2">{order.customer?.name ?? "Guest"}</td>
      <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">{order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</td>
      <td className="px-3 py-2 text-right font-medium tabular">{formatAED(order.total, { precise: true })}</td>
      <td className="px-3 py-2 text-muted-foreground">
        <RelativeTime iso={order.placedAt} />
      </td>
      <td className="px-3 py-2">
        <OrderStatusBadge status={order.status} />
      </td>
      <td className="px-3 py-2">
        {state ? (
          <span className="inline-flex items-center gap-1.5">
            <SlaBadge level={state.level} label={undefined} />
            <ElapsedTimer since={phaseStart(order)} className="font-mono text-xs tabular" />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <OrderActions order={order} showSecondary={false} />
      </td>
    </tr>
  );
}

