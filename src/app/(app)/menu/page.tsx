import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuView } from "@/components/menu/menu-view";
import { PageSkeleton } from "@/components/shared/states";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getMenu } from "@/server/services/menu";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage() {
  const page = await loadPage({ permission: "menu.view" }, (ctx) => [{ queryKey: queryKeys.menu(ctx.scope.key), queryFn: () => getMenu(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <Suspense fallback={<PageSkeleton />}>
        <MenuView />
      </Suspense>
    </HydrationBoundary>
  );
}
