"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocationDirectory, useSystemStatus } from "@/hooks/queries";
import { useLocationScope } from "@/hooks/use-location-scope";
import { CHANNEL_THEME } from "@/lib/channel-theme";
import { formatAED } from "@/lib/format";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
      <OrderArrivalNotifier />
      <Suspense>
        <LocationParamSync />
      </Suspense>
    </div>
  );
}

/** Deep links like /kitchen?location=loc_marina switch the global location context. */
function LocationParamSync() {
  const params = useSearchParams();
  const { scope, setScope } = useLocationScope();
  const { data: locations } = useLocationDirectory();
  const location = params.get("location");
  useEffect(() => {
    if (!location || location === scope) return;
    if (location === "all" || locations?.some((l) => l.id === location)) setScope(location);
  }, [location, scope, setScope, locations]);
  return null;
}

/** Toast when a new order arrives from any channel (demo traffic or injected). */
function OrderArrivalNotifier() {
  const { data } = useSystemStatus();
  const nameOf = useLocationDirectory().data;
  const seen = useRef<Set<string> | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!data) return;
    if (seen.current === null) {
      seen.current = new Set(data.latestOrders.map((o) => o.id));
      return;
    }
    for (const o of data.latestOrders) {
      if (seen.current.has(o.id)) continue;
      seen.current.add(o.id);
      const loc = nameOf?.find((l) => l.id === o.locationId)?.name ?? "";
      toast(`New ${CHANNEL_THEME[o.channel].label} order · ${o.orderNumber}`, {
        description: `${loc} · ${formatAED(o.total, { precise: true })}`,
        action: { label: "Open", onClick: () => router.push(`/orders/${o.id}`) },
      });
    }
  }, [data, nameOf, router]);
  return null;
}
