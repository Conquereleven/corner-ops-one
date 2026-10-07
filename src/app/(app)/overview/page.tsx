import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { OverviewView } from "@/components/dashboard/overview-view";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getOverview } from "@/server/services/overview";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.overview(scope), queryFn: () => getOverview(scope) }]);
  return (
    <HydrationBoundary state={state}>
      <OverviewView />
    </HydrationBoundary>
  );
}
