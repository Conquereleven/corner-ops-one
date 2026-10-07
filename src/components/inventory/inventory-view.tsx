"use client";

import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, PackagePlus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader, Panel } from "@/components/shared/page-header";
import { StockBadge } from "@/components/shared/status";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { RelativeTime } from "@/components/shared/time";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { movementInputSchema, MOVEMENT_TYPES, type MovementType, type StockStatus } from "@/domain/inventory/types";
import { useInventory, useLocationDirectory, useLocationName, useRecordMovement } from "@/hooks/queries";
import { useLocationScope } from "@/hooks/use-location-scope";
import { formatAED, formatDecimal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InventoryItemView } from "@/server/services/inventory";

const STATUS_RANK: Record<StockStatus, number> = { out: 0, critical: 1, low: 2, healthy: 3 };
const MOVEMENT_META: Record<MovementType, { label: string; Icon: typeof Ban; cls: string }> = {
  purchase: { label: "Purchase", Icon: ArrowDownLeft, cls: "text-emerald-700 bg-emerald-50" },
  usage: { label: "Usage", Icon: ArrowUpRight, cls: "text-zinc-600 bg-zinc-100" },
  adjustment: { label: "Adjustment", Icon: SlidersHorizontal, cls: "text-blue-700 bg-blue-50" },
  waste: { label: "Waste", Icon: Trash2, cls: "text-red-700 bg-red-50" },
  transfer: { label: "Transfer", Icon: ArrowLeftRight, cls: "text-violet-700 bg-violet-50" },
};

function qty(v: number, unit: string) {
  return `${unit === "pcs" || unit === "bunch" ? Math.round(v) : formatDecimal(v)} ${unit}`;
}

export function InventoryView() {
  const { data, isLoading, error, refetch } = useInventory();
  const params = useSearchParams();
  const { scope } = useLocationScope();
  const locationName = useLocationName();
  const highlight = params.get("item");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [filter, setFilter] = useState<"attention" | "all" | "healthy">(highlight || params.get("q") ? "all" : "attention");
  const [category, setCategory] = useState("all");
  const [movementFor, setMovementFor] = useState<InventoryItemView | null>(null);

  const categories = useMemo(() => [...new Set(data?.items.map((i) => i.category) ?? [])], [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.items
      .filter((i) => (filter === "attention" ? i.status !== "healthy" : filter === "healthy" ? i.status === "healthy" : true))
      .filter((i) => category === "all" || i.category === category)
      .filter((i) => !term || i.name.toLowerCase().includes(term) || i.id === highlight)
      .sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.hoursLeft ?? 999) - (b.hoursLeft ?? 999)));
  }, [data, q, filter, category, highlight]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <PageSkeleton />;
  const itemName = (id: string) => data.items.find((i) => i.id === id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description="Operational stock by location. Ingredient levels drive menu availability; usage is deducted automatically from accepted orders."
        actions={
          <Button size="sm" variant="outline" className="bg-card" onClick={() => setMovementFor(data.items[0])}>
            <PackagePlus /> Record movement
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Healthy" value={data.counts.healthy} hint="items at par" />
        <KpiCard label="Low" value={<span className={data.counts.low ? "text-amber-700" : ""}>{data.counts.low}</span>} hint="below threshold" />
        <KpiCard label="Critical" value={<span className={data.counts.critical ? "text-orange-700" : ""}>{data.counts.critical}</span>} hint="≤ 50% of threshold" />
        <KpiCard label="Out of stock" value={<span className={data.counts.out ? "text-red-600" : ""}>{data.counts.out}</span>} hint="blocking items" />
        <KpiCard label="Menu items unavailable" value={data.unavailableMenuItems.length} hint="due to stock" />
        <KpiCard label="Stock value" value={formatAED(data.stockValue)} hint="at unit cost" />
      </div>

      {data.unavailableMenuItems.length ? (
        <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <Ban className="size-4" /> Menu items currently unavailable because of stock
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {data.unavailableMenuItems.map((m) => (
              <li key={m.id} className="rounded-md bg-card px-2.5 py-1.5 text-xs ring-1 ring-red-200">
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {m.locations.map(locationName).join(", ")} · {m.causes.join(", ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-red-900/70">Marketplace availability updates are simulated in v0.1 — in production these items would be paused on each channel automatically.</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-60">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ingredient" className="h-8 bg-card pl-8" />
            </div>
            <div className="flex rounded-lg border bg-card p-0.5">
              {(["attention", "all", "healthy"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn("h-7 rounded-md px-2.5 text-xs font-medium", filter === f ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {f === "attention" ? `Needs attention (${data.counts.low + data.counts.critical + data.counts.out})` : f === "all" ? "All" : "Healthy"}
                </button>
              ))}
            </div>
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-sm">
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="relative overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/[0.08]">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Ingredient</th>
                  {scope === "all" ? <th className="px-3 py-2 font-medium">Location</th> : null}
                  <th className="px-3 py-2 font-medium">On hand vs par</th>
                  <th className="px-3 py-2 text-right font-medium">Threshold</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Usage / hr</th>
                  <th className="px-3 py-2 text-right font-medium">Runs out</th>
                  <th className="px-3 py-2 font-medium">Affects</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((i) => (
                  <tr key={i.id} className={cn("hover:bg-muted/40", i.id === highlight && "bg-amber-50/70")}>
                    <td className="px-4 py-2">
                      <div className="font-medium">{i.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {i.category} · {i.supplier}
                      </div>
                    </td>
                    {scope === "all" ? <td className="px-3 py-2 text-muted-foreground">{locationName(i.locationId)}</td> : null}
                    <td className="px-3 py-2">
                      <StockBar item={i} />
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">{qty(i.threshold, i.unit)}</td>
                    <td className="px-3 py-2">
                      <StockBadge status={i.status} />
                    </td>
                    <td className="px-3 py-2 text-right tabular text-muted-foreground">{i.usagePerHour ? qty(i.usagePerHour, i.unit) : "—"}</td>
                    <td className={cn("px-3 py-2 text-right tabular", i.hoursLeft !== null && i.hoursLeft < 4 ? "font-semibold text-red-600" : "text-muted-foreground")}>
                      {i.status === "out" ? "Now" : i.hoursLeft === null ? "—" : i.hoursLeft < 1 ? "< 1h" : i.hoursLeft > 72 ? "3d+" : `~${Math.round(i.hoursLeft)}h`}
                    </td>
                    <td className="max-w-52 px-3 py-2 text-xs">
                      {i.blocking.length ? (
                        <span className="font-medium text-red-600">Blocks {i.blocking.map((b) => b.name).join(", ")}</span>
                      ) : (
                        <span className="line-clamp-1 text-muted-foreground" title={i.usedBy.map((u) => u.name).join(", ")}>
                          {i.usedBy.length} item{i.usedBy.length === 1 ? "" : "s"}: {i.usedBy.map((u) => u.name).join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="xs" variant="outline" onClick={() => setMovementFor(i)}>
                        Adjust
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nothing here — stock is healthy.</p> : null}
          </div>
        </div>

        <Panel title="Recent movements" description="Purchases, usage, waste, transfers" bodyClassName="p-0">
          <ul className="max-h-[640px] divide-y overflow-y-auto">
            {data.movements.slice(0, 60).map((m) => {
              const meta = MOVEMENT_META[m.type];
              const item = itemName(m.inventoryItemId);
              return (
                <li key={m.id} className="flex items-start gap-2.5 px-4 py-2">
                  <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md", meta.cls)}>
                    <meta.Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{item?.name ?? "Item"}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {meta.label} · {locationName(m.locationId)}
                      {m.note ? ` · ${m.note}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("text-xs font-semibold tabular", m.quantity >= 0 ? "text-emerald-700" : "text-foreground")}>
                      {m.quantity >= 0 ? "+" : "−"}
                      {qty(Math.abs(m.quantity), item?.unit ?? "")}
                    </div>
                    <RelativeTime iso={m.createdAt} className="text-[11px] text-muted-foreground" />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <MovementDialog item={movementFor} items={data.items} onClose={() => setMovementFor(null)} />
    </div>
  );
}

function StockBar({ item }: { item: InventoryItemView }) {
  const max = Math.max(item.parLevel, item.quantity) || 1;
  const tone = item.status === "healthy" ? "bg-good" : item.status === "low" ? "bg-warning" : item.status === "critical" ? "bg-serious" : "bg-critical";
  return (
    <div className="w-44">
      <div className="flex justify-between text-xs">
        <span className="font-semibold tabular">{qty(item.quantity, item.unit)}</span>
        <span className="tabular text-muted-foreground">par {qty(item.parLevel, item.unit)}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, (item.quantity / max) * 100)}%` }} />
        <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-foreground/50" style={{ left: `${(item.threshold / max) * 100}%` }} title="Threshold" />
      </div>
    </div>
  );
}

function MovementDialog({ item, items, onClose }: { item: InventoryItemView | null; items: InventoryItemView[]; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{item ? <MovementForm key={item.id} initial={item} items={items} onDone={onClose} /> : null}</DialogContent>
    </Dialog>
  );
}

function MovementForm({ initial, items, onDone }: { initial: InventoryItemView; items: InventoryItemView[]; onDone: () => void }) {
  const record = useRecordMovement();
  const { data: locations } = useLocationDirectory();
  const locationName = useLocationName();
  const [itemId, setItemId] = useState(initial.id);
  const [type, setType] = useState<MovementType>(initial.status === "healthy" ? "adjustment" : "purchase");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const item = items.find((i) => i.id === itemId) ?? initial;

  const submit = () => {
    const parsed = movementInputSchema.safeParse({
      inventoryItemId: itemId,
      type,
      quantity: Number(quantity),
      note: note || undefined,
      targetLocationId: type === "transfer" ? target : undefined,
    });
    if (!parsed.success || !quantity) {
      setErr(parsed.success ? "Enter a quantity" : parsed.error.issues[0].message);
      return;
    }
    if (type === "transfer" && !target) {
      setErr("Choose a destination location");
      return;
    }
    record.mutate(parsed.data, { onSuccess: onDone, onError: (e) => setErr(e.message) });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record inventory movement</DialogTitle>
        <DialogDescription>
          {item.name} · {locationName(item.locationId)} · on hand {qty(item.quantity, item.unit)}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">Item</span>
          <select className="h-8 w-full rounded-lg border bg-card px-2 text-sm" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} — {locationName(i.locationId)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-5 gap-1">
          {MOVEMENT_TYPES.map((t) => {
            const m = MOVEMENT_META[t];
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn("flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium", type === t ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}
              >
                <m.Icon className="size-4" /> {m.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">
              Quantity ({item.unit}){type === "adjustment" ? " — use negative to reduce" : ""}
            </span>
            <Input type="number" step="0.1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="h-8" autoFocus />
          </label>
          {type === "transfer" ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">To location</span>
              <select className="h-8 w-full rounded-lg border bg-card px-2 text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select…</option>
                {locations?.filter((l) => l.id !== item.locationId).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Note</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="h-8" maxLength={200} />
            </label>
          )}
        </div>
        {err ? <p className="text-xs text-red-600">{err}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={record.isPending}>
          Record {MOVEMENT_META[type].label.toLowerCase()}
        </Button>
      </DialogFooter>
    </>
  );
}
