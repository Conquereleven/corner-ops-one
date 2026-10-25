import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { LocationsView } from "@/components/locations/locations-view";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getLocations } from "@/server/services/locations";

export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage() {
  const page = await loadPage({ permission: "locations.view" }, (ctx) => [{ queryKey: queryKeys.locations(), queryFn: () => getLocations(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <LocationsView />
    </HydrationBoundary>
  );
}
