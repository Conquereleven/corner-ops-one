import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { ProfitabilityView } from "@/components/analytics/profitability-view";
import { analyticsRangeSchema } from "@/domain/analytics/range";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getProfitability } from "@/server/services/analytics";

export const metadata: Metadata = { title: "Profitability" };

export default async function ProfitabilityPage({ searchParams }: PageProps<"/profitability">) {
  const range = analyticsRangeSchema.catch("7d").parse((await searchParams).range);
  const page = await loadPage({ permission: "profitability.view" }, (ctx) => [{ queryKey: queryKeys.profitability(ctx.scope.key, range), queryFn: () => getProfitability(ctx, range) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <ProfitabilityView initialRange={range} />
    </HydrationBoundary>
  );
}
