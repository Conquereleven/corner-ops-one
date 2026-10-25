import { HydrationBoundary } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OrderDetail } from "@/components/orders/order-detail";
import { Forbidden } from "@/components/shared/forbidden";
import { queryKeys } from "@/lib/query-keys";
import { loadPage } from "@/server/page";
import { getOrder } from "@/server/services/orders";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  const page = await loadPage({ permission: "orders.view" }, (ctx) => [{ queryKey: queryKeys.order(id), queryFn: () => getOrder(ctx, id) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <div className="mx-auto max-w-5xl">
        <Link href="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Live Orders
        </Link>
        <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/[0.08]">
          <OrderDetail orderId={id} />
        </div>
      </div>
    </HydrationBoundary>
  );
}
