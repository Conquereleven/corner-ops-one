import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getKitchenBoard } from "@/server/services/kitchen";

export const metadata: Metadata = { title: "Kitchen" };

export default async function KitchenPage() {
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.kitchen(scope), queryFn: () => getKitchenBoard(scope) }]);
  return (
    <HydrationBoundary state={state}>
      <KitchenBoard />
    </HydrationBoundary>
  );
}
