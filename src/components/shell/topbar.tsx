"use client";

import {
  Activity,
  Building2,
  Bell,
  Boxes,
  Check,
  ChevronsUpDown,
  FlaskConical,
  LogOut,
  MapPin,
  Menu,
  ReceiptText,
  Search,
  Settings,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChannelMark } from "@/components/shared/channel-badge";
import { ConnectionBadge, SeverityIcon } from "@/components/shared/status";
import { RelativeTime } from "@/components/shared/time";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ORDER_CHANNELS, type OrderChannel } from "@/domain/channels/types";
import {
  useAckAlert,
  useInjectOrder,
  useLocationDirectory,
  useSearch,
  useSystemStatus,
  useUpdateSettings,
} from "@/hooks/queries";
import { useLocationScope } from "@/hooks/use-location-scope";
import { useSession } from "@/hooks/use-session";
import { ROLE_LABEL } from "@/domain/auth/permissions";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { cn } from "@/lib/utils";
import { BrandMark, SidebarNav } from "./sidebar";

export function Topbar() {
  const session = useSession();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-5">
      <MobileNav />
      <LocationSwitcher />
      <SearchCommand />
      <div className="ml-auto flex items-center gap-1.5">
        {session.organization.isDemo ? <DemoBadge /> : null}
        {session.organization.isDemo && session.permissions.includes("demo.manage") ? <DemoModeControl /> : null}
        {session.permissions.includes("channels.view") ? <SystemStatus /> : null}
        {session.permissions.includes("alerts.view") ? <Notifications /> : null}
        <UserMenu />
      </div>
    </header>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" />}>
        <Menu />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetTitle className="flex h-14 items-center px-5">
          <BrandMark />
        </SheetTitle>
        <div className="overflow-y-auto py-3">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LocationSwitcher() {
  const { scope, setScope } = useLocationScope();
  const { data: locations } = useLocationDirectory();
  const current = scope === "all" ? "All locations" : (locations?.find((l) => l.id === scope)?.name ?? "…");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="h-8 max-w-52 justify-between gap-2 bg-card font-medium" />}
      >
        <MapPin className="text-muted-foreground" />
        <span className="truncate">{current}</span>
        <ChevronsUpDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Location context</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={scope} onValueChange={(v) => setScope(String(v))}>
            <DropdownMenuRadioItem value="all">All locations</DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {locations?.map((l) => (
              <DropdownMenuRadioItem key={l.id} value={l.id}>
                <span className="w-8 font-mono text-[10px] text-muted-foreground">{l.code}</span>
                {l.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const router = useRouter();
  const { data, isFetching } = useSearch(debounced);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  const hasResults = !!data && (data.orders.length || data.menu.length || data.inventory.length);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-72 items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search orders, items, stock…</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <Search />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search CornerOps" description="Search orders, menu items and inventory">
        <Command shouldFilter={false}>
        <CommandInputWrapper value={q} onChange={setQ} />
        <CommandList>
          {debounced.trim().length < 2 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              Try an order number (CO-21…), a platform ID (TLB-…), a customer or a dish.
            </div>
          ) : !hasResults && !isFetching ? (
            <CommandEmpty>No matches for “{debounced}”.</CommandEmpty>
          ) : null}
          {data?.orders.length ? (
            <CommandGroup heading="Orders">
              {data.orders.map((o) => (
                <CommandItem key={o.id} value={`order-${o.id}`} onSelect={() => go(`/orders/${o.id}`)}>
                  <ReceiptText />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{o.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{o.subtitle}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {data?.menu.length ? (
            <CommandGroup heading="Menu">
              {data.menu.map((m) => (
                <CommandItem key={m.id} value={`menu-${m.id}`} onSelect={() => go(`/menu?q=${encodeURIComponent(m.title)}`)}>
                  <UtensilsCrossed />
                  <span className="truncate">{m.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{m.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {data?.inventory.length ? (
            <CommandGroup heading="Inventory">
              {data.inventory.map((i) => (
                <CommandItem key={i.id} value={`inv-${i.id}`} onSelect={() => go(`/inventory?item=${i.id}`)}>
                  <Boxes />
                  <span className="truncate">{i.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{i.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function CommandInputWrapper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <CommandInput placeholder="Search by order ID, platform ID, customer, item…" value={value} onValueChange={onChange} />;
}

function Notifications() {
  const { data } = useSystemStatus();
  const ack = useAckAlert();
  const count = data?.alertCount ?? 0;
  const critical = data?.criticalCount ?? 0;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${count})`} />}>
        <Bell />
        {count > 0 ? (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4 text-white tabular",
              critical ? "bg-critical" : "bg-foreground",
            )}
          >
            {count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <div className="text-sm font-semibold">Operational alerts</div>
          <span className="text-xs text-muted-foreground">{count} open</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {!data?.alerts.length ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">All clear — nothing needs attention.</div>
          ) : (
            data.alerts.map((a) => (
              <div key={a.id} className="group flex gap-2.5 border-b px-3 py-2.5 last:border-0 hover:bg-muted/50">
                <SeverityIcon severity={a.severity} className="mt-0.5" />
                <Link href={a.href} className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-snug">{a.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.detail}</div>
                  <RelativeTime iso={a.createdAt} className="mt-1 block text-[11px] text-muted-foreground/80" />
                </Link>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-60 group-hover:opacity-100"
                  aria-label="Acknowledge"
                  title="Acknowledge"
                  onClick={() => ack.mutate(a.id)}
                >
                  <Check />
                </Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SystemStatus() {
  const { data, isError } = useSystemStatus();
  const overall = isError ? "outage" : (data?.overall ?? "operational");
  const label = isError ? "Offline" : overall === "operational" ? "All channels live" : overall === "degraded" ? "Channel degraded" : "Channel down";
  const dot = overall === "operational" ? "bg-good" : overall === "degraded" ? "bg-warning" : "bg-critical";
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className="hidden gap-2 text-xs font-medium text-muted-foreground sm:inline-flex" />}
      >
        <span className="relative flex size-2">
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-50", dot)} />
          <span className={cn("relative inline-flex size-2 rounded-full", dot)} />
        </span>
        {label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Activity className="size-4 text-muted-foreground" />
          <div className="text-sm font-semibold">Channel connections</div>
        </div>
        <ul className="divide-y">
          {data?.channels.map((c) => (
            <li key={c.channel} className="flex items-center gap-2.5 px-3 py-2">
              <ChannelMark channel={c.channel} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{CHANNEL_THEME[c.channel].label}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {c.latencyMs}ms · synced <RelativeTime iso={c.lastSyncAt} />
                </div>
              </div>
              <ConnectionBadge status={c.status} />
            </li>
          ))}
        </ul>
        <div className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          All integrations run in <strong className="font-semibold text-foreground/80">mock mode</strong> — no platform credentials are used.{" "}
          <Link className="underline underline-offset-2" href="/channels">
            Manage
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DemoModeControl() {
  const { data } = useSystemStatus();
  const { data: locations } = useLocationDirectory();
  const { scope } = useLocationScope();
  const update = useUpdateSettings();
  const inject = useInjectOrder();
  const [picked, setLocation] = useState<string | null>(null);
  const location = picked ?? (scope === "all" ? "loc_marina" : scope);
  const enabled = data?.demo.enabled ?? false;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium transition-colors",
              enabled ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" : "bg-card text-muted-foreground hover:bg-muted",
            )}
          />
        }
      >
        <FlaskConical className="size-3" />
        <span className="hidden sm:inline">Simulator</span>
        {enabled ? <span className="size-1.5 rounded-full bg-amber-500" /> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] gap-0 p-0">
        <div className="border-b px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Demo mode</div>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => update.mutate({ demo: { enabled: v } })}
              aria-label="Toggle simulation"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Simulated traffic from mock channel adapters. Nothing here is a production event.
          </p>
        </div>
        <div className="space-y-2 px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">Simulate an incoming order</div>
            <select
              aria-label="Location"
              className="h-7 rounded-md border bg-card px-1.5 text-xs"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              {locations?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {ORDER_CHANNELS.map((ch) => (
              <Button
                key={ch}
                variant="outline"
                size="sm"
                className="justify-start gap-1.5 bg-card text-xs"
                disabled={inject.isPending}
                onClick={() => inject.mutate({ channel: ch as OrderChannel, locationId: location })}
              >
                <ChannelMark channel={ch} size="xs" />
                {CHANNEL_THEME[ch].short}
              </Button>
            ))}
          </div>
        </div>
        {data?.events.length ? (
          <div className="border-t px-3 py-2.5">
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Simulation feed</div>
            <ul className="space-y-1">
              {data.events.slice(0, 5).map((e) => (
                <li key={e.id} className="flex gap-2 text-xs">
                  <RelativeTime iso={e.at} className="w-16 shrink-0 text-muted-foreground" />
                  <span className="truncate">{e.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="border-t px-3 py-2 text-right">
          <Link href="/settings#demo" className="text-xs font-medium underline-offset-2 hover:underline">
            Simulation settings →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Unmistakable (but discreet) marker that this is the Demo Workspace, not a production organization. */
function DemoBadge() {
  return (
    <span
      className="inline-flex h-6 items-center rounded-md bg-amber-500 px-2 text-[10px] font-bold tracking-[0.16em] text-white"
      title="Demo Workspace — simulated data, isolated from production organizations"
    >
      DEMO
    </span>
  );
}

function initials(name: string | null, email: string) {
  const src = (name ?? email.split("@")[0]).trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function UserMenu() {
  const router = useRouter();
  const session = useSession();
  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };
  const switchOrg = async (organizationId: string) => {
    const res = await fetch("/api/session/organization", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId }) });
    // Full reload: the client query cache belongs to the previous organization.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.ok) window.location.assign("/");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="ml-1 inline-flex size-8 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background"
            aria-label="Account"
          />
        }
      >
        {initials(session.user.name, session.user.email)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="truncate text-sm font-medium text-foreground">{session.user.name ?? session.user.email}</div>
            <div className="truncate text-xs font-normal">
              {ROLE_LABEL[session.role]} · {session.organization.name}
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {session.memberships.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
              {session.memberships.map((m) => (
                <DropdownMenuItem key={m.organizationId} disabled={m.organizationId === session.organization.id} onClick={() => switchOrg(m.organizationId)}>
                  <Building2 />
                  <span className="truncate">{m.organizationName}</span>
                  {m.isDemo ? <span className="ml-auto text-[10px] font-bold text-amber-600">DEMO</span> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        {session.permissions.includes("settings.view") ? (
          <DropdownMenuItem onClick={() => router.push("/settings")}>
            <Settings /> Settings
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onClick={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
