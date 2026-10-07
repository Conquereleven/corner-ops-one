import { HydrationBoundary } from "@tanstack/react-query";
import { LocationScopeProvider } from "@/hooks/use-location-scope";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getLocationDirectory } from "@/server/services/locations";

/** Full-screen surfaces (kitchen display) without the workspace chrome. */
export default async function DisplayLayout({ children }: LayoutProps<"/">) {
  const scope = await getServerScope();
  const state = await prefetch([{ queryKey: queryKeys.directory(), queryFn: getLocationDirectory }]);
  return (
    <LocationScopeProvider initialScope={scope}>
      <HydrationBoundary state={state}>{children}</HydrationBoundary>
    </LocationScopeProvider>
  );
}
