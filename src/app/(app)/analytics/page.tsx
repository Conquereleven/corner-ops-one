import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics/analytics-view";
import { analyticsRangeSchema } from "@/domain/analytics/range";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getAnalytics } from "@/server/services/analytics";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const range = analyticsRangeSchema.catch("7d").parse((await searchParams).range);
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.analytics(scope, range), queryFn: () => getAnalytics(scope, range) }]);
  return (
    <HydrationBoundary state={state}>
      <AnalyticsView initialRange={range} />
    </HydrationBoundary>
  );
}
