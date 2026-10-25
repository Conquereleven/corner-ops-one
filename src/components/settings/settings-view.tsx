"use client";

import { Bot, Building2, FlaskConical, Gauge, Plug, RotateCcw, Timer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ChannelMark } from "@/components/shared/channel-badge";
import { PageHeader, Panel } from "@/components/shared/page-header";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ChannelEconomics, OrderChannel } from "@/domain/channels/types";
import { useResetDemo, useSettings, useUpdateOrganization, useUpdateSettings } from "@/hooks/queries";
import { ROLE_LABEL } from "@/domain/auth/permissions";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import type { SettingsData } from "@/server/services/settings";
import { useCan, useSession } from "@/hooks/use-session";
import { ActivityPanel } from "./activity-panel";
import { LocationsPanel } from "./locations-panel";
import { TeamPanel } from "./team-panel";

export function SettingsView() {
  const { data, isLoading, error, refetch } = useSettings();
  const canViewTeam = useCan("team.view");
  const canViewAudit = useCan("audit.view");
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !data) return <PageSkeleton />;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Organization, locations, team, kitchen targets, channel economics and integrations." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <WorkspacePanel data={data} />
        <LocationsPanel />
        {canViewTeam ? <TeamPanel /> : null}
        <SlaPanel key={JSON.stringify(data.settings.sla)} sla={data.settings.sla} canManage={data.canManage} />
        {data.simulation ? <DemoPanel data={data} /> : null}
        <IntegrationsPanel data={data} />
        {data.settings.economics ? <EconomicsPanel key={JSON.stringify(data.settings.economics)} economics={data.settings.economics} canManage={data.canManage} /> : null}
        {canViewAudit ? <ActivityPanel /> : null}
      </div>
    </div>
  );
}

function WorkspacePanel({ data }: { data: SettingsData }) {
  const session = useSession();
  const canEdit = useCan("organization.manage");
  const update = useUpdateOrganization();
  const [name, setName] = useState(data.organization.name);
  const rows = [
    ["Restaurant", data.restaurant.name],
    ["Currency", data.organization.currency],
    ["Timezone", data.organization.timezone],
    ["Your role", ROLE_LABEL[session.role]],
    ["Organization ID", data.organization.id],
    ["Environment", data.organization.isDemo ? "Demo Workspace" : "Production workspace"],
  ];
  return (
    <Panel title={<Title icon={Building2}>Organization</Title>} description="Every record is scoped to this organization; access is enforced by membership and Row Level Security.">
      <div className="mb-3 flex items-center gap-2">
        <Input className="h-8 max-w-72" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} aria-label="Organization name" />
        {canEdit && name.trim() !== data.organization.name ? (
          <Button size="sm" disabled={name.trim().length < 2 || update.isPending} onClick={() => update.mutate({ name: name.trim() }, { onSuccess: () => window.location.reload() })}>
            Rename
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className={k.includes("ID") ? "font-mono text-xs" : "font-medium"}>{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function SlaPanel({ sla, canManage }: { sla: SettingsData["settings"]["sla"]; canManage: boolean }) {
  const update = useUpdateSettings();
  const [form, setForm] = useState({
    acceptTargetMinutes: String(sla.acceptTargetMinutes),
    prepTargetMinutes: String(sla.prepTargetMinutes),
    pickupTargetMinutes: String(sla.pickupTargetMinutes),
    warningPct: String(Math.round(sla.warningRatio * 100)),
  });
  const save = () =>
    update.mutate(
      {
        sla: {
          acceptTargetMinutes: Number(form.acceptTargetMinutes),
          prepTargetMinutes: Number(form.prepTargetMinutes),
          pickupTargetMinutes: Number(form.pickupTargetMinutes),
          warningRatio: Number(form.warningPct) / 100,
        },
      },
      { onSuccess: () => toast.success("Kitchen targets updated") },
    );
  const field = (key: keyof typeof form, label: string, suffix: string) => (
    <label className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Input type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="h-8" />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </label>
  );
  return (
    <Panel title={<Title icon={Timer}>Kitchen SLA targets</Title>} description="Drive the NORMAL / WARNING / CRITICAL states on orders and the kitchen board.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {field("acceptTargetMinutes", "Accept within", "min")}
        {field("prepTargetMinutes", "Prep target", "min")}
        {field("pickupTargetMinutes", "Pickup within", "min")}
        {field("warningPct", "Warn at", "% of target")}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={save} disabled={!canManage || update.isPending}>
          Save targets
        </Button>
      </div>
    </Panel>
  );
}

function DemoPanel({ data }: { data: SettingsData }) {
  const update = useUpdateSettings();
  const reset = useResetDemo();
  const [confirm, setConfirm] = useState(false);
  const demo = data.settings.demo;
  return (
    <Panel
      title={
        <span id="demo" className="scroll-mt-20">
          <Title icon={FlaskConical}>Demo mode</Title>
        </span>
      }
      description="Simulated traffic through the mock channel adapters. Clearly labelled; never presented as production events."
    >
      <div className="space-y-3 text-sm">
        <Toggle label="Simulation running" hint="New orders arrive and progress through the kitchen." checked={demo.enabled} onChange={(v) => update.mutate({ demo: { enabled: v } })} />
        <Toggle label="Auto-progress untouched orders" hint="Orders you act on are never moved by the simulator." checked={demo.autoProgress} onChange={(v) => update.mutate({ demo: { autoProgress: v } })} />
        <Toggle label="Channel incidents" hint="Occasionally degrade a marketplace connection, then recover." checked={demo.channelIncidents} onChange={(v) => update.mutate({ demo: { channelIncidents: v } })} />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Order frequency</div>
            <div className="text-xs text-muted-foreground">Average seconds between simulated orders</div>
          </div>
          <select
            className="h-8 rounded-lg border bg-card px-2 text-sm"
            value={demo.orderIntervalSeconds}
            onChange={(e) => update.mutate({ demo: { orderIntervalSeconds: Number(e.target.value) } })}
          >
            {[20, 30, 45, 60, 90, 180].map((s) => (
              <option key={s} value={s}>
                every ~{s}s
              </option>
            ))}
          </select>
        </div>
        <div className="rounded-lg border bg-muted/40 p-2.5">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent simulation events</div>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {(data.simulation?.events ?? []).length === 0 ? <li className="text-xs text-muted-foreground">No events yet.</li> : null}
            {(data.simulation?.events ?? []).map((e) => (
              <li key={e.id} className="flex gap-2 text-xs">
                <RelativeTime iso={e.at} className="w-16 shrink-0 text-muted-foreground" />
                <span className="truncate">{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">
            Simulated data only — isolated from production organizations.
          </span>
          <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
            <RotateCcw /> Reset demo data
          </Button>
        </div>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              Restores the Casa Norte demo to its initial state: orders, stock, menu, channels, settings and the demo activity log. Production organizations are never affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                reset.mutate();
                setConfirm(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function IntegrationsPanel({ data }: { data: SettingsData }) {
  return (
    <Panel title={<Title icon={Plug}>Integrations</Title>} description="Each channel is an adapter. Mock and live integrations are strictly separated." bodyClassName="p-0">
      <div className="relative overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Channel</th>
            <th className="px-3 py-2 font-medium">Mode</th>
            <th className="px-3 py-2 font-medium">Stores</th>
            <th className="px-4 py-2 font-medium">Live API</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.integrations.map((i) => (
            <tr key={i.channel}>
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-2">
                  <ChannelMark channel={i.channel} size="xs" /> {i.name}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-500/30">Mock</span>
              </td>
              <td className="px-3 py-2 tabular text-muted-foreground">{i.locations}</td>
              <td className="px-4 py-2 text-xs text-muted-foreground">Not available in v0.1</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="border-t px-4 py-2.5 text-[11px] text-muted-foreground">
        Live adapters will implement the same <code className="font-mono">ChannelAdapter</code> interface with partner-API credentials stored server-side. No credentials are requested in v0.1.
      </p>
      <div className="flex items-start gap-2 border-t px-4 py-2.5 text-xs">
        <Bot className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">AI provider:</span> CornerOps Analyst (deterministic). An LLM provider can be registered in{" "}
          <code className="font-mono">server/services/ai.ts</code> behind the <code className="font-mono">OperationsAIProvider</code> interface.
        </span>
      </div>
    </Panel>
  );
}

function EconomicsPanel({ economics, canManage }: { economics: Record<OrderChannel, ChannelEconomics>; canManage: boolean }) {
  const update = useUpdateSettings();
  const [form, setForm] = useState(() =>
    Object.fromEntries(
      (Object.keys(economics) as OrderChannel[]).map((ch) => [
        ch,
        {
          commission: String(Math.round(economics[ch].commissionRate * 1000) / 10),
          payment: String(Math.round(economics[ch].paymentFeeRate * 1000) / 10),
          funded: String(Math.round(economics[ch].restaurantFundedDiscountShare * 100)),
          delivery: String(economics[ch].deliveryCostPerOrder),
        },
      ]),
    ) as Record<OrderChannel, { commission: string; payment: string; funded: string; delivery: string }>,
  );
  const set = (ch: OrderChannel, k: keyof (typeof form)[OrderChannel], v: string) => setForm({ ...form, [ch]: { ...form[ch], [k]: v } });
  const save = () =>
    update.mutate(
      {
        economics: Object.fromEntries(
          (Object.keys(form) as OrderChannel[]).map((ch) => [
            ch,
            {
              commissionRate: Number(form[ch].commission) / 100,
              paymentFeeRate: Number(form[ch].payment) / 100,
              restaurantFundedDiscountShare: Number(form[ch].funded) / 100,
              deliveryCostPerOrder: Number(form[ch].delivery),
            },
          ]),
        ),
      },
      { onSuccess: () => toast.success("Channel economics updated — profitability recalculated") },
    );
  return (
    <Panel
      className="xl:col-span-2"
      title={
        <span id="economics" className="scroll-mt-20">
          <Title icon={Gauge}>Channel economics</Title>
        </span>
      }
      description="Contract terms used for estimated profitability. Update them to match your agreements."
      bodyClassName="p-0"
    >
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Commission %</th>
              <th className="px-3 py-2 font-medium">Payment fee %</th>
              <th className="px-3 py-2 font-medium">Discount you fund %</th>
              <th className="px-3 py-2 font-medium">Own delivery cost (AED)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(Object.keys(form) as OrderChannel[]).map((ch) => (
              <tr key={ch}>
                <td className="px-4 py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <ChannelMark channel={ch} size="xs" /> {CHANNEL_THEME[ch].label}
                  </span>
                </td>
                {(["commission", "payment", "funded", "delivery"] as const).map((k) => (
                  <td key={k} className="px-3 py-1.5">
                    <Input type="number" step="0.1" min={0} value={form[ch][k]} onChange={(e) => set(ch, k, e.target.value)} className="h-7 w-24" aria-label={`${ch} ${k}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t px-4 py-2.5">
        <Button size="sm" onClick={save} disabled={!canManage || update.isPending}>
          Save economics
        </Button>
      </div>
    </Panel>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function Title({ icon: Icon, children }: { icon: typeof Bot; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="size-4 text-muted-foreground" /> {children}
    </span>
  );
}
