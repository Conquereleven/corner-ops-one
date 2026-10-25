"use client";

import { Bike, Check, CircleAlert, Clock, CreditCard, Phone, ShoppingBag, Store, TriangleAlert, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { OrderStatusBadge, SlaBadge } from "@/components/shared/status";
import { ErrorState } from "@/components/shared/states";
import { ElapsedTimer, RelativeTime } from "@/components/shared/time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_METHOD_LABEL, netSales, type OrderShortfallLine, type UnifiedOrder } from "@/domain/orders/types";
import { useLocationName, useOrder, useResolveShortfall } from "@/hooks/queries";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatClock, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderActions } from "./order-actions";
import { phaseStart, useSla } from "./order-card";

const STEPS: { key: keyof UnifiedOrder; label: string }[] = [
  { key: "placedAt", label: "Received" },
  { key: "acceptedAt", label: "Accepted" },
  { key: "preparationStartedAt", label: "Preparing" },
  { key: "readyAt", label: "Ready" },
  { key: "pickedUpAt", label: "Picked up" },
  { key: "completedAt", label: "Completed" },
];

function minutesBetween(a?: string, b?: string) {
  if (!a || !b) return null;
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
}

export function OrderDetail({ orderId, compact }: { orderId: string; compact?: boolean }) {
  const { data, isLoading, error, refetch } = useOrder(orderId);
  const locationName = useLocationName();

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { order, customer, channelLogs, sla, shortfalls, canResolveShortfall } = data;
  return (
    <div className="space-y-4">
      {shortfalls.length ? <ShortfallPanel orderId={order.id} lines={shortfalls} canResolve={canResolveShortfall} /> : null}
      <OrderDetailBody order={order} customer={customer} logs={channelLogs} sla={sla} locationName={locationName(order.locationId)} compact={compact} />
    </div>
  );
}

function ShortfallPanel({ orderId, lines, canResolve }: { orderId: string; lines: OrderShortfallLine[]; canResolve: boolean }) {
  const resolve = useResolveShortfall();
  const [note, setNote] = useState("");
  const open = lines.filter((l) => l.status === "open");
  const qty = (v: number, unit?: string) => `${Math.round(v * 1000) / 1000}${unit ? ` ${unit}` : ""}`;
  return (
    <section className={cn("rounded-lg border px-3 py-2.5 text-sm", open.length ? "border-red-300 bg-red-50/70" : "bg-muted/30")}>
      <div className="flex items-center gap-2 font-semibold">
        <TriangleAlert className={cn("size-4", open.length ? "text-red-600" : "text-muted-foreground")} />
        {open.length ? "Inventory shortfall — fulfilment blocked" : "Inventory shortfall resolved"}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Only stock on hand was deducted when the order was accepted; nothing went negative. Resolving is a manager decision and is recorded in the audit log.
      </p>
      <ul className="mt-2 divide-y rounded-md border bg-card">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
            <span className="font-medium">{l.ingredientKey.replace(/_/g, " ")}{l.inventoryItemId ? "" : " (not stocked here)"}</span>
            <span className="tabular text-muted-foreground">
              needed {qty(l.requestedQuantity, l.unit)} · used {qty(l.consumedQuantity, l.unit)} · short {qty(l.unmetQuantity, l.unit)}
            </span>
            <span className={cn("font-medium", l.status === "open" ? "text-red-700" : "text-emerald-700")}>
              {l.status === "open" ? "open" : l.resolution === "reconciled_from_stock" ? "reconciled" : "accepted"}
            </span>
          </li>
        ))}
      </ul>
      {open.length && canResolve ? (
        <div className="mt-2 space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (required to accept the shortfall): substitution, omitted ingredient, comp…" className="min-h-14 bg-card text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="bg-card" disabled={resolve.isPending} onClick={() => resolve.mutate({ orderId, method: "reconcile_from_stock", note: note || undefined })}>
              Deduct from current stock
            </Button>
            <Button size="sm" variant="outline" className="bg-card" disabled={resolve.isPending || !note.trim()} onClick={() => resolve.mutate({ orderId, method: "accept_shortfall", note })}>
              Accept shortfall
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OrderDetailBody({
  order,
  customer,
  logs,
  sla,
  locationName,
  compact,
}: {
  order: UnifiedOrder;
  customer: { name: string; phone: string; area: string; lifetimeOrders: number } | null;
  logs: { id: string; message: string; at: string; level: string }[];
  sla: Parameters<typeof useSla>[1];
  locationName: string;
  compact?: boolean;
}) {
  const state = useSla(order, sla);
  const platformFee = order.platformFee ?? 0;
  const estimated = order.metadata?.platformFeeEstimated === true;
  const channelMeta = Object.entries(order.metadata ?? {}).filter(([k]) => ["talabat", "deliveroo", "noon", "keeta", "direct", "whatsapp"].includes(k));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-lg font-semibold">#{order.orderNumber}</h2>
            <OrderStatusBadge status={order.status} />
            {state ? <SlaBadge level={state.level} /> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <ChannelBadge channel={order.channel} className="text-foreground" size="xs" />
            <span className="font-mono">{order.externalOrderId}</span>
            <span className="inline-flex items-center gap-1">
              <Store className="size-3" /> {locationName}
            </span>
            <span>Received {formatDateTime(order.placedAt)}</span>
          </div>
        </div>
        {state ? (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{state.phase} timer</div>
            <div className={cn("font-mono text-xl font-semibold tabular", state.level === "critical" && "text-red-600", state.level === "warning" && "text-amber-700")}>
              <ElapsedTimer since={phaseStart(order)} />
            </div>
            <div className="text-[11px] text-muted-foreground">target {Math.round(state.targetMs / 60000)} min</div>
          </div>
        ) : null}
      </div>

      <OrderActions order={order} size="default" className="[&>button:first-child]:min-w-40" />

      {order.syncStatus === "failed" ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Last status change was saved in CornerOps but not confirmed by {CHANNEL_THEME[order.channel].label}. It will be retried when the connection recovers.
        </div>
      ) : null}

      <div className={cn("grid gap-4", !compact && "lg:grid-cols-[1.4fr_1fr]")}>
        <div className="space-y-4">
          {/* Items */}
          <section className="rounded-lg border">
            <header className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items</header>
            <ul className="divide-y">
              {order.items.map((l) => (
                <li key={l.id} className="flex gap-3 px-3 py-2 text-sm">
                  <span className="w-7 font-semibold tabular">{l.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{l.name}</div>
                    {l.modifiers.map((m) => (
                      <div key={m.name} className="text-xs text-muted-foreground">
                        + {m.name}
                        {m.price ? ` (${formatAED(m.price)})` : ""}
                      </div>
                    ))}
                    {l.notes ? <div className="mt-0.5 text-xs font-medium text-amber-700">“{l.notes}”</div> : null}
                    {!l.menuItemId ? <div className="text-xs text-red-600">Not mapped to master menu</div> : null}
                  </div>
                  <span className="tabular">{formatAED(l.total, { precise: true })}</span>
                </li>
              ))}
            </ul>
            {order.notes ? <div className="border-t bg-amber-50/60 px-3 py-2 text-xs text-amber-900">Order note: {order.notes}</div> : null}
            <dl className="space-y-1 border-t px-3 py-2.5 text-sm">
              <Row label="Subtotal" value={formatAED(order.subtotal, { precise: true })} />
              {order.discount ? <Row label="Discount" value={`−${formatAED(order.discount, { precise: true })}`} /> : null}
              {order.deliveryFee ? <Row label="Delivery fee" value={formatAED(order.deliveryFee, { precise: true })} /> : null}
              <Row label="VAT (5%)" value={formatAED(order.tax, { precise: true })} />
              <Row label="Total charged" value={formatAED(order.total, { precise: true })} strong />
              <div className="my-1.5 border-t" />
              <Row label="Net food sales" value={formatAED(netSales(order), { precise: true })} muted />
              {platformFee ? <Row label={`Platform commission${estimated ? " (est.)" : ""}`} value={`−${formatAED(platformFee, { precise: true })}`} muted /> : null}
            </dl>
          </section>

          {/* Timeline */}
          <section className="rounded-lg border">
            <header className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</header>
            <ol className="px-3 py-2.5">
              {STEPS.map((step, i) => {
                const at = order[step.key] as string | undefined;
                const prev = STEPS.slice(0, i).map((s) => order[s.key] as string | undefined).filter(Boolean).at(-1);
                const mins = minutesBetween(prev, at);
                return (
                  <li key={step.key} className="flex items-center gap-3 py-1 text-sm">
                    <span className={cn("flex size-5 items-center justify-center rounded-full border", at ? "border-foreground bg-foreground text-background" : "border-dashed text-muted-foreground")}>
                      {at ? <Check className="size-3" /> : null}
                    </span>
                    <span className={cn("flex-1", !at && "text-muted-foreground")}>{step.label}</span>
                    {at && i > 0 && mins !== null ? <span className="whitespace-nowrap text-xs text-muted-foreground">+{mins} min</span> : null}
                    <span className="w-12 text-right font-mono text-xs tabular">{at ? formatClock(at) : "—"}</span>
                  </li>
                );
              })}
              {order.cancelledAt ? (
                <li className="mt-1 flex items-center gap-3 rounded-md bg-red-50 px-2 py-1.5 text-sm text-red-700">
                  <CircleAlert className="size-4" />
                  <span className="flex-1">Cancelled — {order.cancellationReason}</span>
                  <span className="font-mono text-xs">{formatClock(order.cancelledAt)}</span>
                </li>
              ) : null}
            </ol>
          </section>
        </div>

        <div className="space-y-4">
          <section className="space-y-2 rounded-lg border px-3 py-2.5 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</div>
            <div className="flex items-center gap-2">
              <User className="size-4 text-muted-foreground" /> {order.customer?.name ?? "Guest"}
            </div>
            {order.customer?.phone ? (
              <div className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" /> <span className="font-mono text-xs">{order.customer.phone}</span>
              </div>
            ) : null}
            {customer ? (
              <div className="text-xs text-muted-foreground">
                {customer.lifetimeOrders} lifetime orders · {customer.area}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Guest profile shared by platform (limited data)</div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <CreditCard className="size-4 text-muted-foreground" /> {PAYMENT_METHOD_LABEL[order.paymentMethod]}
            </div>
          </section>

          <section className="space-y-1.5 rounded-lg border px-3 py-2.5 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fulfilment</div>
            <div className="flex items-center gap-2">
              {order.fulfillment === "pickup" ? <ShoppingBag className="size-4 text-muted-foreground" /> : <Bike className="size-4 text-muted-foreground" />}
              {order.fulfillment === "pickup" ? "Customer pickup" : `Delivery by ${order.courier?.provider === "restaurant" ? "own fleet" : CHANNEL_THEME[order.channel].label}`}
            </div>
            {order.courier ? (
              <div className="text-xs text-muted-foreground">
                Rider: {order.courier.name ?? "not yet assigned"} · {order.courier.status.replace("_", " ")}
                {order.courier.etaMinutes ? ` · ETA ${order.courier.etaMinutes} min` : ""}
              </div>
            ) : null}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="size-3.5" /> Estimated prep {order.estimatedPrepMinutes} min
            </div>
          </section>

          <section className="space-y-1.5 rounded-lg border px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channel sync</div>
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-500/30">
                {order.source === "seed" ? "Demo data" : "Mock integration"}
              </span>
            </div>
            <div className="text-xs">
              Write-back:{" "}
              <span className={cn("font-medium", order.syncStatus === "failed" ? "text-red-600" : "text-emerald-700")}>
                {order.syncStatus === "failed" ? "failed — pending retry" : "confirmed"}
              </span>
            </div>
            {channelMeta.map(([k, v]) => (
              <pre key={k} className="relative overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify({ [k]: v }, null, 1)}
              </pre>
            ))}
            {logs.length ? (
              <ul className="space-y-1 pt-1">
                {logs.map((l) => (
                  <li key={l.id} className="flex gap-2 text-[11px]">
                    <RelativeTime iso={l.at} className="w-16 shrink-0 text-muted-foreground" />
                    <span className={cn("truncate font-mono", l.level === "error" && "text-red-600", l.level === "warning" && "text-amber-700")}>{l.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          {compact ? (
            <Link href={`/orders/${order.id}`} className="block text-center text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Open full order page →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "font-semibold", muted && "text-xs text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
