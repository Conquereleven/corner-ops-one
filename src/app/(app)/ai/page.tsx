import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { AIView } from "@/components/ai/ai-view";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getBriefing } from "@/server/services/ai";

export const metadata: Metadata = { title: "AI Operations" };

export default async function AIPage() {
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.briefing(scope), queryFn: () => getBriefing(scope) }]);
  return (
    <HydrationBoundary state={state}>
      <AIView />
    </HydrationBoundary>
  );
}
