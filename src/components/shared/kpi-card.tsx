import { Delta } from "./delta";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  delta,
  goodWhen = "up",
  comparison = "vs yesterday",
  icon: Icon,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  goodWhen?: "up" | "down";
  comparison?: string;
  icon?: React.ComponentType<{ className?: string }>;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl bg-card p-3.5 ring-1 ring-foreground/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      </div>
      <div className="truncate text-2xl font-semibold tracking-tight tabular">{value}</div>
      <div className="flex min-h-4 items-center gap-1.5 truncate">
        {delta !== undefined ? <Delta value={delta} goodWhen={goodWhen} /> : null}
        {delta !== undefined ? <span className="truncate text-xs text-muted-foreground">{comparison}</span> : null}
        {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}
