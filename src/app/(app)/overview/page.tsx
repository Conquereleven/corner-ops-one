import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { OverviewView } from "@/components/dashboard/overview-view";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getOverview } from "@/server/services/overview";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const page = await loadPage({ permission: "overview.view" }, (ctx) => [{ queryKey: queryKeys.overview(ctx.scope.key), queryFn: () => getOverview(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <OverviewView />
    </HydrationBoundary>
  );
}
