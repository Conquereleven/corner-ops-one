import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { ProfitabilityView } from "@/components/analytics/profitability-view";
import { analyticsRangeSchema } from "@/domain/analytics/range";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getProfitability } from "@/server/services/analytics";

export const metadata: Metadata = { title: "Profitability" };

export default async function ProfitabilityPage({ searchParams }: PageProps<"/profitability">) {
  const range = analyticsRangeSchema.catch("7d").parse((await searchParams).range);
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.profitability(scope, range), queryFn: () => getProfitability(scope, range) }]);
  return (
    <HydrationBoundary state={state}>
      <ProfitabilityView initialRange={range} />
    </HydrationBoundary>
  );
}
