"use client";

import { FlaskConical, Plug, RefreshCw, ScrollText, Unplug } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ChannelMark } from "@/components/shared/channel-badge";
import { Delta } from "@/components/shared/delta";
import { PageHeader } from "@/components/shared/page-header";
import { ConnectionBadge, ConnectionDot } from "@/components/shared/status";
import { ErrorState, PageSkeleton } from "@/components/shared/states";
import { RelativeTime } from "@/components/shared/time";
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OrderChannel } from "@/domain/channels/types";
import { useChannelLogs, useChannels, useConnectionAction, useLocationName } from "@/hooks/queries";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChannelsData } from "@/server/services/channels";

type ChannelCardData = ChannelsData[number];

export function ChannelsView() {
  const { data, isLoading, error, refetch } = useChannels();
  const params = useSearchParams();
  const [logsFor, setLogsFor] = useState<OrderChannel | null>(null);
  const focus = params.get("channel");

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Channels"
        description="Every sales channel connects through a CornerOps adapter and is normalized into one order model."
      />
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
        <FlaskConical className="mt-0.5 size-4 shrink-0" />
        <div>
          <span className="font-medium">All six integrations run in mock mode.</span> The adapters implement the same interface a live integration
          will use, but talk to a simulated platform — no Talabat, Deliveroo, Noon or Keeta credentials are used, and connect/disconnect only changes the
          simulated connection.
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {data.map((c) => (
          <ChannelCard key={c.channel} channel={c} focused={focus === c.channel} onLogs={() => setLogsFor(c.channel)} />
        ))}
      </div>
      <LogsSheet channel={logsFor} onClose={() => setLogsFor(null)} />
    </div>
  );
}

function ChannelCard({ channel: c, focused, onLogs }: { channel: ChannelCardData; focused: boolean; onLogs: () => void }) {
  const action = useConnectionAction();
  const locationName = useLocationName();
  const [confirm, setConfirm] = useState<{ locationId?: string } | null>(null);
  const allDisconnected = c.connections.every((x) => x.status === "disconnected");

  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.03)]", focused && "ring-2 ring-foreground/50")}>
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <ChannelMark channel={c.channel} size="lg" />
          <div>
            <h2 className="font-semibold">{c.name}</h2>
            <div className="text-xs text-muted-foreground">
              {c.kind === "marketplace" ? "Delivery marketplace" : "Owned channel"} · <span className="font-medium text-amber-700">mock adapter</span>
            </div>
          </div>
        </div>
        <ConnectionBadge status={c.status} />
      </header>

      <dl className="grid grid-cols-3 gap-px bg-border/60 text-sm">
        <Stat label="Last sync" value={<RelativeTime iso={c.lastSyncAt} />} />
        <Stat label="Orders today" value={c.ordersToday} />
        <Stat
          label="Revenue today"
          value={
            <span>
              {formatAED(c.revenueToday)}
              <Delta className="ml-1 whitespace-nowrap" value={c.revenueYesterday ? ((c.revenueToday - c.revenueYesterday) / c.revenueYesterday) * 100 : null} />
            </span>
          }
        />
        <Stat label="Locations" value={`${c.coverage.connected} / ${c.coverage.total}`} />
        <Stat label="Errors (24h)" value={<span className={c.errors24h ? "text-red-600" : ""}>{c.errors24h}</span>} />
        <Stat label="Menu synced" value={`${c.menu.synced} / ${c.menu.total}`} />
      </dl>

      <div className="flex-1 px-4 py-3">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Store connections</div>
        <ul className="space-y-1">
          {c.connections.map((conn) => (
            <li key={conn.id} className="flex items-center gap-2 text-[13px]">
              <ConnectionDot status={conn.status} />
              <span className="w-28 truncate font-medium">{locationName(conn.locationId)}</span>
              <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">{conn.externalStoreId}</span>
              <span className="text-[11px] tabular text-muted-foreground">{conn.status === "disconnected" ? "offline" : `${conn.latencyMs}ms`}</span>
              {!c.canManage ? null : conn.status === "disconnected" ? (
                <Button size="xs" variant="ghost" onClick={() => action.mutate({ channel: c.channel, action: "connect", locationId: conn.locationId })}>
                  Connect
                </Button>
              ) : conn.status === "degraded" ? (
                <Button size="xs" variant="ghost" onClick={() => action.mutate({ channel: c.channel, action: "reconnect", locationId: conn.locationId })}>
                  Reconnect
                </Button>
              ) : (
                <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm({ locationId: conn.locationId })}>
                  Disconnect
                </Button>
              )}
            </li>
          ))}
          {c.coverage.configured < c.coverage.total ? (
            <li className="text-[11px] text-muted-foreground">Not listed at {c.coverage.total - c.coverage.configured} location(s)</li>
          ) : null}
        </ul>
        {c.message ? <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">{c.message}</p> : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        {!c.canManage ? null : allDisconnected ? (
          <Button size="sm" onClick={() => action.mutate({ channel: c.channel, action: "connect" })} disabled={action.isPending}>
            <Plug /> Connect
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => action.mutate({ channel: c.channel, action: "reconnect" })} disabled={action.isPending}>
              <RefreshCw /> Reconnect
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm({})}>
              <Unplug /> Disconnect
            </Button>
          </>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">{formatPercent(c.cancellationRate)} cancelled today</span>
        <Button size="sm" variant="ghost" onClick={onLogs}>
          <ScrollText /> View logs
        </Button>
      </footer>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {c.name}
              {confirm?.locationId ? ` at ${locationName(confirm.locationId)}` : " everywhere"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              New orders will queue on the (simulated) platform and won&apos;t reach CornerOps or the kitchen until you reconnect. Status updates for open
              orders will fail to sync.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                action.mutate({ channel: c.channel, action: "disconnect", locationId: confirm?.locationId });
                setConfirm(null);
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5 sm:px-4">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold tabular">{value}</dd>
    </div>
  );
}

function LogsSheet({ channel, onClose }: { channel: OrderChannel | null; onClose: () => void }) {
  const { data, isLoading } = useChannelLogs(channel);
  const locationName = useLocationName();
  return (
    <Sheet open={!!channel} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            {channel ? <ChannelMark channel={channel} /> : null}
            {channel ? CHANNEL_THEME[channel].label : ""} integration log
          </SheetTitle>
          <SheetDescription>Adapter events from the mock integration (newest first).</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : !data?.length ? (
            <p className="p-4 text-sm text-muted-foreground">No log entries yet.</p>
          ) : (
            <ul className="divide-y font-mono text-[11px]">
              {data.map((l) => (
                <li key={l.id} className="flex gap-3 px-4 py-2">
                  <RelativeTime iso={l.at} className="w-20 shrink-0 font-sans text-muted-foreground" />
                  <span
                    className={cn(
                      "w-12 shrink-0 font-sans font-semibold uppercase",
                      l.level === "error" ? "text-red-600" : l.level === "warning" ? "text-amber-700" : "text-muted-foreground",
                    )}
                  >
                    {l.level === "warning" ? "warn" : l.level}
                  </span>
                  <span className="min-w-0 flex-1 break-words">
                    {l.locationId ? <span className="text-muted-foreground">[{locationName(l.locationId)}] </span> : null}
                    {l.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
