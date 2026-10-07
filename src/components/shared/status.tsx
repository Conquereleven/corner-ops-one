import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  Info,
  PackageCheck,
  PackageX,
  Plug,
  Unplug,
  XCircle,
  Zap,
} from "lucide-react";
import type { AlertSeverity } from "@/domain/alerts/types";
import type { ConnectionStatus } from "@/domain/channels/types";
import type { StockStatus } from "@/domain/inventory/types";
import { STOCK_STATUS_LABEL } from "@/domain/inventory/types";
import type { MappingStatus } from "@/domain/menu/types";
import { MAPPING_STATUS_LABEL } from "@/domain/menu/types";
import { SLA_LABEL, type SlaLevel } from "@/domain/orders/sla";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/domain/orders/types";
import { cn } from "@/lib/utils";

const chip = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap";

const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
  new: "bg-blue-50 text-blue-700 ring-blue-600/20",
  accepted: "bg-violet-50 text-violet-700 ring-violet-600/20",
  preparing: "bg-amber-50 text-amber-800 ring-amber-600/25",
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  picked_up: "bg-sky-50 text-sky-700 ring-sky-600/20",
  completed: "bg-zinc-100 text-zinc-600 ring-zinc-500/15",
  cancelled: "bg-red-50 text-red-700 ring-red-600/20",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn(chip, "uppercase tracking-wide text-[10px]", ORDER_STATUS_STYLE[status], className)}>
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}

const SLA_STYLE: Record<SlaLevel, { cls: string; Icon: typeof Clock }> = {
  normal: { cls: "bg-zinc-50 text-zinc-600 ring-zinc-500/15", Icon: Clock },
  warning: { cls: "bg-amber-50 text-amber-800 ring-amber-500/30", Icon: AlertTriangle },
  critical: { cls: "bg-red-50 text-red-700 ring-red-600/25", Icon: AlertOctagon },
};

export function SlaBadge({ level, className, label }: { level: SlaLevel; className?: string; label?: string }) {
  const { cls, Icon } = SLA_STYLE[level];
  return (
    <span className={cn(chip, cls, className)}>
      <Icon className="size-3" aria-hidden />
      {label ?? SLA_LABEL[level]}
    </span>
  );
}

const CONNECTION: Record<ConnectionStatus, { label: string; cls: string; Icon: typeof Plug }> = {
  connected: { label: "Connected", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: CheckCircle2 },
  degraded: { label: "Degraded", cls: "bg-amber-50 text-amber-800 ring-amber-500/30", Icon: Zap },
  disconnected: { label: "Disconnected", cls: "bg-red-50 text-red-700 ring-red-600/25", Icon: Unplug },
};

export function ConnectionBadge({ status, className, compact }: { status: ConnectionStatus; className?: string; compact?: boolean }) {
  const c = CONNECTION[status];
  return (
    <span className={cn(chip, c.cls, className)}>
      <c.Icon className="size-3" aria-hidden />
      {compact ? null : c.label}
      {compact ? <span className="sr-only">{c.label}</span> : null}
    </span>
  );
}

export function ConnectionDot({ status }: { status: ConnectionStatus }) {
  const color = status === "connected" ? "bg-good" : status === "degraded" ? "bg-warning" : "bg-critical";
  return <span className={cn("inline-block size-2 rounded-full", color)} aria-label={CONNECTION[status].label} />;
}

const STOCK: Record<StockStatus, { cls: string; Icon: typeof Plug }> = {
  healthy: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", Icon: PackageCheck },
  low: { cls: "bg-amber-50 text-amber-800 ring-amber-500/30", Icon: AlertTriangle },
  critical: { cls: "bg-orange-50 text-orange-800 ring-orange-600/30", Icon: AlertOctagon },
  out: { cls: "bg-red-50 text-red-700 ring-red-600/25", Icon: PackageX },
};

export function StockBadge({ status, className }: { status: StockStatus; className?: string }) {
  const s = STOCK[status];
  return (
    <span className={cn(chip, s.cls, className)}>
      <s.Icon className="size-3" aria-hidden />
      {STOCK_STATUS_LABEL[status]}
    </span>
  );
}

const MAPPING: Record<MappingStatus, { cls: string; Icon: typeof Plug }> = {
  synced: { cls: "text-emerald-700", Icon: CheckCircle2 },
  pending: { cls: "text-blue-700", Icon: CircleDashed },
  out_of_sync: { cls: "text-amber-800", Icon: AlertTriangle },
  missing: { cls: "text-zinc-500", Icon: CircleDot },
  error: { cls: "text-red-700", Icon: XCircle },
};

export function MappingStatusLabel({ status, className, iconOnly }: { status: MappingStatus; className?: string; iconOnly?: boolean }) {
  const m = MAPPING[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", m.cls, className)}>
      <m.Icon className={cn(iconOnly ? "size-4" : "size-3.5", status === "pending" && "animate-spin [animation-duration:2.5s]")} aria-hidden />
      <span className={iconOnly ? "sr-only" : undefined}>{MAPPING_STATUS_LABEL[status]}</span>
    </span>
  );
}

const SEVERITY: Record<AlertSeverity, { cls: string; Icon: typeof Plug; label: string }> = {
  critical: { cls: "text-red-600", Icon: AlertOctagon, label: "Critical" },
  warning: { cls: "text-amber-600", Icon: AlertTriangle, label: "Warning" },
  info: { cls: "text-blue-600", Icon: Info, label: "Info" },
};

export function SeverityIcon({ severity, className }: { severity: AlertSeverity; className?: string }) {
  const s = SEVERITY[severity];
  return <s.Icon className={cn("size-4 shrink-0", s.cls, className)} aria-label={s.label} />;
}
