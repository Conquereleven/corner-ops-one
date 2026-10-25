import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryView } from "@/components/inventory/inventory-view";
import { PageSkeleton } from "@/components/shared/states";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getInventory } from "@/server/services/inventory";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const page = await loadPage({ permission: "inventory.view" }, (ctx) => [{ queryKey: queryKeys.inventory(ctx.scope.key), queryFn: () => getInventory(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <Suspense fallback={<PageSkeleton />}>
        <InventoryView />
      </Suspense>
    </HydrationBoundary>
  );
}
