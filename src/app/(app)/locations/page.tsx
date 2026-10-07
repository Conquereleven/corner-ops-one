import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { LocationsView } from "@/components/locations/locations-view";
import { queryKeys } from "@/lib/query-keys";
import { prefetch } from "@/server/prefetch";
import { getLocations } from "@/server/services/locations";

export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage() {
  const state = await prefetch([{ queryKey: queryKeys.locations(), queryFn: getLocations }]);
  return (
    <HydrationBoundary state={state}>
      <LocationsView />
    </HydrationBoundary>
  );
}
