import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ChannelsView } from "@/components/channels/channels-view";
import { PageSkeleton } from "@/components/shared/states";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getChannels } from "@/server/services/channels";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const page = await loadPage({ permission: "channels.view" }, (ctx) => [{ queryKey: queryKeys.channels(ctx.scope.key), queryFn: () => getChannels(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <Suspense fallback={<PageSkeleton />}>
        <ChannelsView />
      </Suspense>
    </HydrationBoundary>
  );
}
