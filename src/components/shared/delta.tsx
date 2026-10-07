import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Percentage change with direction icon. `goodWhen` sets whether an increase is
 * good (revenue) or bad (prep time, cancellations).
 */
export function Delta({
  value,
  goodWhen = "up",
  className,
  suffix,
}: {
  value: number | null | undefined;
  goodWhen?: "up" | "down";
  className?: string;
  suffix?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const good = flat ? null : goodWhen === "up" ? up : !up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        good === null ? "text-muted-foreground" : good ? "text-emerald-700" : "text-red-600",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {formatDelta(value)}
      {suffix ? <span className="ml-1 font-normal text-muted-foreground">{suffix}</span> : null}
    </span>
  );
}
