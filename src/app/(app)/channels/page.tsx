import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ChannelsView } from "@/components/channels/channels-view";
import { PageSkeleton } from "@/components/shared/states";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getChannels } from "@/server/services/channels";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.channels(scope), queryFn: () => getChannels(scope) }]);
  return (
    <HydrationBoundary state={state}>
      <Suspense fallback={<PageSkeleton />}>
        <ChannelsView />
      </Suspense>
    </HydrationBoundary>
  );
}
