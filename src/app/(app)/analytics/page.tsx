import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { analyticsRangeSchema } from "@/domain/analytics/range";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getAnalytics } from "@/server/services/analytics";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const range = analyticsRangeSchema.catch("7d").parse((await searchParams).range);
  const page = await loadPage({ permission: "analytics.view" }, (ctx) => [{ queryKey: queryKeys.analytics(ctx.scope.key, range), queryFn: () => getAnalytics(ctx, range) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <AnalyticsView initialRange={range} />
    </HydrationBoundary>
  );
}
