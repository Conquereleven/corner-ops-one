import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryView } from "@/components/inventory/inventory-view";
import { PageSkeleton } from "@/components/shared/states";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getInventory } from "@/server/services/inventory";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.inventory(scope), queryFn: () => getInventory(scope) }]);
  return (
    <HydrationBoundary state={state}>
      <Suspense fallback={<PageSkeleton />}>
        <InventoryView />
      </Suspense>
    </HydrationBoundary>
  );
}
