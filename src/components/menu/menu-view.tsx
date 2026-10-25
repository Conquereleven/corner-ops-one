"use client";

import { Ban, RefreshCw, Search, UploadCloud } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ChannelMark } from "@/components/shared/channel-badge";
import { PageHeader } from "@/components/shared/page-header";
import { MappingStatusLabel } from "@/components/shared/status";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ORDER_CHANNELS, type OrderChannel } from "@/domain/channels/types";
import { MAPPING_STATUS_LABEL } from "@/domain/menu/types";
import { useLocationName, useMenu, useMenuSync, useMenuUpdate } from "@/hooks/queries";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MenuItemView } from "@/server/services/menu";

export function MenuView() {
  const { data, isLoading, error, refetch } = useMenu();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState<string>("all");
  const channelFilter = params.get("channel") as OrderChannel | null;
  const [openId, setOpenId] = useState<string | null>(null);
  const sync = useMenuSync();
  const update = useMenuUpdate();
  const locationName = useLocationName();

  const items = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    return data.items.filter((i) => {
      if (category !== "all" && i.categoryId !== category) return false;
      if (term && !`${i.name} ${i.sku}`.toLowerCase().includes(term)) return false;
      if (channelFilter && i.mappings.find((m) => m.channel === channelFilter)?.status === "synced") return false;
      return true;
    });
  }, [data, q, category, channelFilter]);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <PageSkeleton />;
  const open = data.items.find((i) => i.id === openId) ?? null;
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Master Menu"
        description="One canonical menu in CornerOps, mapped to every marketplace listing. Publishing to marketplaces is simulated in v0.1."
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {data.mappingSummary.map((m) => {
          const active = channelFilter === m.channel;
          return (
            <div key={m.channel} className={cn("rounded-xl bg-card p-3 ring-1 ring-foreground/[0.08]", active && "ring-2 ring-foreground/50")}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  <ChannelMark channel={m.channel} size="xs" /> {CHANNEL_THEME[m.channel].short}
                </span>
                <span className="text-xs tabular text-muted-foreground">
                  {m.synced}/{m.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-good" style={{ width: `${(m.synced / m.total) * 100}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-1">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => router.replace(active ? pathname : `${pathname}?channel=${m.channel}`, { scroll: false })}
                >
                  {m.issues ? `${m.issues} issue${m.issues > 1 ? "s" : ""}` : m.pending ? `${m.pending} syncing` : "All synced"}
                </button>
                {m.issues && data.canManage ? (
                  <Button size="xs" variant="outline" className="bg-card" disabled={sync.isPending} onClick={() => sync.mutate({ channel: m.channel })}>
                    <UploadCloud /> Publish
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dish or SKU" className="h-8 bg-card pl-8" />
        </div>
        <div className="flex flex-wrap gap-1">
          {[{ id: "all", name: "All" }, ...data.categories].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={cn("h-8 rounded-lg px-3 text-xs font-medium", category === c.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
            >
              {c.name}
            </button>
          ))}
        </div>
        {channelFilter ? (
          <Button size="sm" variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
            Showing items not synced on {CHANNEL_THEME[channelFilter].short} · clear
          </Button>
        ) : null}
      </div>

      <div className="relative overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/[0.08]">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Food cost</th>
              <th className="px-3 py-2 text-right font-medium">Prep</th>
              <th className="px-3 py-2 text-right font-medium">Sold today</th>
              <th className="px-3 py-2 font-medium">Availability</th>
              {ORDER_CHANNELS.map((c) => (
                <th key={c} className="px-1.5 py-2 text-center font-medium">
                  <span className="inline-flex" title={CHANNEL_THEME[c].label}>
                    <ChannelMark channel={c} size="xs" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((i) => {
              const blocked = i.availability.filter((a) => !a.available);
              return (
                <tr key={i.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenId(i.id)}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-base" aria-hidden>
                        {i.imageEmoji}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">{i.name}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {i.sku}
                          {i.tags.map((t) => (
                            <span key={t} className="ml-1.5 rounded bg-muted px-1 font-sans text-[10px] uppercase">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{catName(i.categoryId)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular">{formatAED(i.price)}</td>
                  <td className={cn("px-3 py-2 text-right tabular", i.foodCostPct > 35 ? "text-amber-700" : "text-muted-foreground")}>{formatPercent(i.foodCostPct, 0)}</td>
                  <td className="px-3 py-2 text-right tabular text-muted-foreground">{i.prepTimeMinutes}m</td>
                  <td className="px-3 py-2 text-right tabular">{i.soldToday}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <Switch
                        size="sm"
                        disabled={!data.canManage}
                        checked={i.isAvailable}
                        onCheckedChange={(v) => update.mutate({ id: i.id, patch: { isAvailable: v } })}
                        aria-label={`${i.name} available`}
                      />
                      {!i.isAvailable ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                          <Ban className="size-3" /> 86&apos;d
                        </span>
                      ) : blocked.length ? (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex items-center gap-1 text-xs font-medium text-red-600" />}>
                            <Ban className="size-3" /> Out at {blocked.length}
                          </TooltipTrigger>
                          <TooltipContent>
                            {blocked.map((b) => `${locationName(b.locationId)}: ${b.blockedBy.map((x) => x.name).join(", ")}`).join(" · ")}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-muted-foreground">Selling</span>
                      )}
                    </div>
                  </td>
                  {i.mappings.map((m) => (
                    <td key={m.channel} className="px-1.5 py-2 text-center">
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          <MappingStatusLabel status={m.status} iconOnly />
                        </TooltipTrigger>
                        <TooltipContent>
                          {CHANNEL_THEME[m.channel].label}: {MAPPING_STATUS_LABEL[m.status]}
                          {m.message ? ` — ${m.message}` : ""}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No items match.</p> : null}
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-5 sm:max-w-xl data-[side=right]:sm:max-w-xl">
          <SheetTitle className="sr-only">Menu item</SheetTitle>
          {open ? <MenuItemDetail key={open.id} canManage={data.canManage} item={open} categoryName={catName(open.categoryId)} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MenuItemDetail({ item, categoryName, canManage }: { item: MenuItemView; categoryName: string; canManage: boolean }) {
  const update = useMenuUpdate();
  const sync = useMenuSync();
  const locationName = useLocationName();
  const [price, setPrice] = useState(String(item.price));
  const [prep, setPrep] = useState(String(item.prepTimeMinutes));
  const dirty = Number(price) !== item.price || Number(prep) !== item.prepTimeMinutes;
  const valid = Number(price) > 0 && Number.isInteger(Number(prep)) && Number(prep) >= 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <span className="flex size-12 items-center justify-center rounded-lg bg-muted text-2xl" aria-hidden>
          {item.imageEmoji}
        </span>
        <div>
          <h2 className="text-lg font-semibold">{item.name}</h2>
          <div className="text-xs text-muted-foreground">
            {categoryName} · <span className="font-mono">{item.sku}</span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{item.description}</p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Price (AED)</span>
          <Input type="number" min={1} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Prep time (min)</span>
          <Input type="number" min={0} step="1" value={prep} onChange={(e) => setPrep(e.target.value)} className="h-8" />
        </label>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Food cost</span>
          <div className="h-8 leading-8 font-medium tabular">
            {formatAED(item.foodCost, { precise: true })} <span className="text-xs text-muted-foreground">({formatPercent((item.foodCost / Number(price || item.price)) * 100, 0)})</span>
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">VAT</span>
          <div className="h-8 leading-8 font-medium">{(item.taxRate * 100).toFixed(0)}%</div>
        </div>
        <div className="col-span-full flex items-center justify-between border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled={!canManage} checked={item.isAvailable} onCheckedChange={(v) => update.mutate({ id: item.id, patch: { isAvailable: v } })} />
            Available on all channels
          </label>
          <Button
            size="sm"
            disabled={!canManage || !dirty || !valid || update.isPending}
            onClick={() => update.mutate({ id: item.id, patch: { price: Number(price), prepTimeMinutes: Number(prep) } })}
          >
            Save changes
          </Button>
        </div>
        {Number(price) !== item.price && dirty ? (
          <p className="col-span-full text-xs text-amber-700">Changing the master price marks marketplace listings out of sync until republished.</p>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Marketplace mapping</h3>
        <div className="divide-y rounded-lg border">
          {item.mappings.map((m) => (
            <div key={m.channel} className="flex items-center gap-3 px-3 py-2 text-sm">
              <ChannelMark channel={m.channel} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{CHANNEL_THEME[m.channel].label}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {m.externalItemId ?? "no listing"}
                  {m.channelPrice !== null ? ` · AED ${m.channelPrice}` : ""}
                  {m.message ? <span className="font-sans"> · {m.message}</span> : null}
                </div>
              </div>
              <MappingStatusLabel status={m.status} />
              {canManage && m.status !== "synced" && m.status !== "pending" ? (
                <Button size="xs" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate({ channel: m.channel, menuItemId: item.id })}>
                  <RefreshCw /> {m.status === "missing" ? "Publish" : "Sync"}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Availability by location</h3>
        <div className="divide-y rounded-lg border">
          {item.availability.map((a) => (
            <div key={a.locationId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>{locationName(a.locationId)}</span>
              {a.available ? (
                <span className="text-xs text-emerald-700">
                  Selling{a.atRisk.length ? <span className="text-amber-700"> · low: {a.atRisk.map((r) => r.name).join(", ")}</span> : null}
                </span>
              ) : (
                <span className="text-xs font-medium text-red-600">
                  Unavailable{a.blockedBy.length ? ` — ${a.blockedBy.map((b) => b.name).join(", ")} out` : " (86'd)"}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Availability is derived from ingredient stock. Future: automatic availability push to marketplaces.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipe (per portion)</h3>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {item.recipe.map((r) => (
            <li key={r.inventoryItemKey} className="flex justify-between border-b border-dashed py-1">
              <span className="text-muted-foreground">{r.inventoryItemKey.replace(/_/g, " ")}</span>
              <span className="tabular">{r.quantity}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
