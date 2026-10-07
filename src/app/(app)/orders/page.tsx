import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersView } from "@/components/orders/orders-view";
import { PageSkeleton } from "@/components/shared/states";
import { orderFiltersSchema } from "@/domain/orders/types";
import { parseOrderFilters, queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { listOrders } from "@/server/services/orders";

export const metadata: Metadata = { title: "Live Orders" };

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const scope = await getServerScope();
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters = parseOrderFilters(get);
  const state = await prefetch([
    {
      queryKey: queryKeys.orders(scope, filters),
      queryFn: () => listOrders(scope, orderFiltersSchema.parse({ ...filters, location: filters.filterLocation, delayed: filters.delayed || undefined })),
    },
  ]);
  return (
    <HydrationBoundary state={state}>
      <Suspense fallback={<PageSkeleton />}>
        <OrdersView />
      </Suspense>
    </HydrationBoundary>
  );
}
