import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getKitchenBoard } from "@/server/services/kitchen";

export const metadata: Metadata = { title: "Kitchen" };

export default async function KitchenPage() {
  const page = await loadPage({ permission: "kitchen.view" }, (ctx) => [{ queryKey: queryKeys.kitchen(ctx.scope.key), queryFn: () => getKitchenBoard(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <KitchenBoard />
    </HydrationBoundary>
  );
}
