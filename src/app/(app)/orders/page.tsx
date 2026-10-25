import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersView } from "@/components/orders/orders-view";
import { PageSkeleton } from "@/components/shared/states";
import { orderFiltersSchema } from "@/domain/orders/types";
import { parseOrderFilters, queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { listOrders } from "@/server/services/orders";

export const metadata: Metadata = { title: "Live Orders" };

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters = parseOrderFilters(get);
  const page = await loadPage({ permission: "orders.view" }, (ctx) => [
    {
      queryKey: queryKeys.orders(ctx.scope.key, filters),
      queryFn: () => listOrders(ctx, orderFiltersSchema.parse({ ...filters, location: filters.filterLocation, delayed: filters.delayed || undefined })),
    },
  ]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <Suspense fallback={<PageSkeleton />}>
        <OrdersView />
      </Suspense>
    </HydrationBoundary>
  );
}
