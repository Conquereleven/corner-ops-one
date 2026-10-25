"use client";

import { Ban, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { availableActions, primaryAction, TRANSITIONS, type OrderAction } from "@/domain/orders/state-machine";
import type { UnifiedOrder } from "@/domain/orders/types";
import { useOrderAction } from "@/hooks/queries";
import { useCan } from "@/hooks/use-session";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { cn } from "@/lib/utils";

const CANCEL_REASONS = ["Item unavailable", "Kitchen too busy", "Customer requested", "Rider not assigned", "Duplicate order", "Suspected fraud"];

const PRIMARY_STYLE: Partial<Record<OrderAction, string>> = {
  accept: "bg-blue-600 text-white hover:bg-blue-700",
  start_preparing: "bg-amber-500 text-white hover:bg-amber-600",
  mark_ready: "bg-emerald-600 text-white hover:bg-emerald-700",
  mark_picked_up: "bg-sky-600 text-white hover:bg-sky-700",
  complete: "",
};

export function OrderActions({
  order,
  size = "sm",
  className,
  showSecondary = true,
  stretch,
}: {
  order: UnifiedOrder;
  size?: "sm" | "default" | "lg";
  className?: string;
  showSecondary?: boolean;
  stretch?: boolean;
}) {
  const mutation = useOrderAction();
  const canProgress = useCan("orders.progress");
  const canCancelRole = useCan("orders.cancel");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const primary = canProgress ? primaryAction(order) : null;
  const actions = availableActions(order).filter((a) => (a === "cancel" ? canCancelRole : canProgress));
  const secondary = actions.filter((a) => a !== primary && a !== "cancel");
  const canCancel = actions.includes("cancel");
  const busy = mutation.isPending;

  const run = (action: OrderAction, r?: string) => mutation.mutate({ order, action, reason: r });

  if (!primary && !canCancel) return null;

  return (
    <div className={cn("flex items-center gap-1.5", className)} onClick={(e) => e.stopPropagation()}>
      {primary && actions.includes(primary) ? (
        <Button size={size} className={cn("font-semibold", PRIMARY_STYLE[primary], stretch && "flex-1")} disabled={busy} onClick={() => run(primary)}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {TRANSITIONS[primary].label}
        </Button>
      ) : null}
      {showSecondary && (secondary.length > 0 || canCancel) ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size={size === "lg" ? "default" : size} variant="outline" className="bg-card" aria-label="More actions" />}>
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {secondary.map((a) => (
              <DropdownMenuItem key={a} onClick={() => run(a)}>
                {TRANSITIONS[a].label}
              </DropdownMenuItem>
            ))}
            {secondary.length && canCancel ? <DropdownMenuSeparator /> : null}
            {canCancel ? (
              <DropdownMenuItem variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban /> Cancel order…
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {order.orderNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              The cancellation is sent to {CHANNEL_THEME[order.channel].label} ({order.externalOrderId}) and cannot be undone from CornerOps. The
              customer may be refunded by the platform.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-1.5">
            {CANCEL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                  reason === r ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                run("cancel", reason);
                setCancelOpen(false);
              }}
            >
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
