"use client";

import { useNow } from "@/hooks/use-now";
import { formatClock, formatRelative, formatTimer } from "@/lib/format";

/** Relative time that ticks; renders the absolute clock time until mounted (no hydration mismatch). */
export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const now = useNow();
  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} className={className} title={formatClock(iso)}>
      {now === null ? formatClock(iso) : formatRelative(iso, now)}
    </time>
  );
}

export function ElapsedTimer({ since, className }: { since: string | undefined; className?: string }) {
  const now = useNow();
  if (!since) return <span className={className}>—</span>;
  return <span className={className}>{now === null ? "--:--" : formatTimer(now - Date.parse(since))}</span>;
}
