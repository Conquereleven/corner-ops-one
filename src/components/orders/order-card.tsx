"use client";

import { Bike, Clock, CreditCard, ShoppingBag, Store } from "lucide-react";
import { ChannelBadge } from "@/components/shared/channel-badge";
import { OrderStatusBadge, SlaBadge } from "@/components/shared/status";
import { ElapsedTimer, RelativeTime } from "@/components/shared/time";
import { computeSla, type SlaSettings } from "@/domain/orders/sla";
import { ACTIVE_STATUSES, PAYMENT_METHOD_LABEL, type UnifiedOrder } from "@/domain/orders/types";
import { useNow } from "@/hooks/use-now";
import { formatAED } from "@/lib/format";
import { cn } from "@/lib/utils";
import { OrderActions } from "./order-actions";

const COURIER_LABEL = {
  unassigned: "Awaiting rider",
  assigned: "Rider assigned",
  arriving: "Rider arriving",
  at_restaurant: "Rider at restaurant",
  picked_up: "On the way",
  delivered: "Delivered",
} as const;

export function useSla(order: UnifiedOrder, sla: SlaSettings | undefined) {
  const now = useNow();
  if (!sla || now === null || !ACTIVE_STATUSES.includes(order.status)) return null;
  return computeSla(order, now, sla);
}

/** Start of the currently-timed phase, for the live timer. */
export function phaseStart(order: UnifiedOrder): string | undefined {
  if (order.status === "new") return order.placedAt;
  if (order.status === "accepted" || order.status === "preparing") return order.acceptedAt ?? order.placedAt;
  if (order.status === "ready") return order.readyAt;
  return undefined;
}

export function OrderCard({
  order,
  locationName,
  sla,
  onOpen,
  selected,
}: {
  order: UnifiedOrder;
  locationName: string;
  sla?: SlaSettings;
  onOpen: () => void;
  selected?: boolean;
}) {
  const state = useSla(order, sla);
  const now = useNow();
  const lines = order.items.slice(0, 3);
  const extra = order.items.length - lines.length;
  const fresh = now !== null && order.source !== "seed" && now - Date.parse(order.createdAt) < 20_000;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className={cn(
        "group flex cursor-pointer flex-col rounded-xl bg-card ring-1 ring-foreground/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow outline-none hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring",
        state?.level === "critical" && "ring-red-300 hover:ring-red-400",
        state?.level === "warning" && "ring-amber-300",
        selected && "ring-2 ring-foreground/60",
        fresh && "animate-arrive",
      )}
    >
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-semibold">#{order.orderNumber}</span>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ChannelBadge channel={order.channel} short className="text-foreground" size="xs" />
            <span className="truncate font-mono text-[11px]">{order.externalOrderId}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-semibold tabular">{formatAED(order.total, { precise: true })}</div>
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
            <CreditCard className="size-3" />
            {PAYMENT_METHOD_LABEL[order.paymentMethod]}
          </div>
        </div>
      </div>

      <ul className="mt-2.5 space-y-0.5 px-3.5 text-[13px]">
        {lines.map((l) => (
          <li key={l.id} className="flex gap-2">
            <span className="w-6 shrink-0 font-semibold tabular">{l.quantity}×</span>
            <span className="truncate">
              {l.name}
              {l.modifiers.length ? <span className="text-muted-foreground"> · {l.modifiers.map((m) => m.name).join(", ")}</span> : null}
            </span>
          </li>
        ))}
        {extra > 0 ? <li className="pl-8 text-xs text-muted-foreground">+{extra} more item{extra > 1 ? "s" : ""}</li> : null}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Store className="size-3" />
          {locationName}
        </span>
        <span className="truncate">{order.customer?.name ?? "Guest"}</span>
        <span>
          Received <RelativeTime iso={order.placedAt} />
        </span>
        <span className="inline-flex items-center gap-1">
          {order.fulfillment === "pickup" ? <ShoppingBag className="size-3" /> : <Bike className="size-3" />}
          {order.fulfillment === "pickup" ? "Pickup" : order.courier ? COURIER_LABEL[order.courier.status] : "Delivery"}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {state ? (
            <>
              <SlaBadge level={state.level} />
              <span className="inline-flex items-center gap-1 font-mono tabular text-foreground">
                <Clock className="size-3" />
                <ElapsedTimer since={phaseStart(order)} />
              </span>
            </>
          ) : (
            <span>Updated <RelativeTime iso={order.updatedAt} /></span>
          )}
        </div>
        <OrderActions order={order} />
      </div>
    </article>
  );
}
