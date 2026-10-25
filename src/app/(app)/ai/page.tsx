import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { AIView } from "@/components/ai/ai-view";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getBriefing } from "@/server/services/ai";

export const metadata: Metadata = { title: "AI Operations" };

export default async function AIPage() {
  const page = await loadPage({ permission: "ai.view" }, (ctx) => [{ queryKey: queryKeys.briefing(ctx.scope.key), queryFn: () => getBriefing(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <AIView />
    </HydrationBoundary>
  );
}
