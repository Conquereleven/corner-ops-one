import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { Suspense } from "react";
import { MenuView } from "@/components/menu/menu-view";
import { PageSkeleton } from "@/components/shared/states";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getMenu } from "@/server/services/menu";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage() {
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.menu(scope), queryFn: () => getMenu(scope) }]);
  return (
    <HydrationBoundary state={state}>
      <Suspense fallback={<PageSkeleton />}>
        <MenuView />
      </Suspense>
    </HydrationBoundary>
  );
}
