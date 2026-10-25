"use client";

import { History } from "lucide-react";
import { Panel } from "@/components/shared/page-header";
import { RelativeTime } from "@/components/shared/time";
import { useActivity } from "@/hooks/queries";

function summarize(before: unknown, after: unknown): string {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return "";
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return Object.keys(a)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .slice(0, 3)
    .map((k) => `${k}: ${short(b[k])} → ${short(a[k])}`)
    .join(" · ");
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return "…";
  const s = String(v);
  return s.length > 24 ? `${s.slice(0, 21)}…` : s;
}

export function ActivityPanel() {
  const { data, isLoading } = useActivity();
  return (
    <Panel
      className="xl:col-span-2"
      title={
        <span className="inline-flex items-center gap-1.5">
          <History className="size-4 text-muted-foreground" /> Activity log
        </span>
      }
      description="Audit trail: who changed what, when, where, from what to what. Append-only."
      bodyClassName="p-0"
    >
      {isLoading || !data ? (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : data.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No changes recorded yet.</p>
      ) : (
        <ul className="max-h-[420px] divide-y overflow-y-auto">
          {data.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-2 text-xs">
              <RelativeTime iso={e.createdAt} className="w-20 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div>
                  <span className="font-medium">{e.actorName ?? (e.actorLabel === "simulator" ? "Demo simulator" : e.actorLabel ?? "System")}</span>{" "}
                  <span className="font-mono text-[11px] text-muted-foreground">{e.action}</span>{" "}
                  <span className="text-muted-foreground">
                    {e.entityType} {String(e.metadata?.orderNumber ?? e.metadata?.name ?? e.entityId).slice(0, 40)}
                  </span>
                </div>
                <div className="truncate text-muted-foreground">{summarize(e.before, e.after)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
