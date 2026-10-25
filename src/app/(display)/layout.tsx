import { HydrationBoundary } from "@tanstack/react-query";
import { SessionProvider } from "@/hooks/use-session";
import { LocationScopeProvider } from "@/hooks/use-location-scope";
import { queryKeys } from "@/lib/query-keys";
import { loadShell } from "@/server/page";
import { getLocationDirectory } from "@/server/services/locations";

/** Full-screen surfaces (kitchen display) without the workspace chrome. */
export default async function DisplayLayout({ children }: LayoutProps<"/">) {
  const { session, state } = await loadShell((ctx) => [{ queryKey: queryKeys.directory(), queryFn: () => getLocationDirectory(ctx) }]);
  return (
    <SessionProvider session={session}>
      <LocationScopeProvider initialScope={session.scope}>
        <HydrationBoundary state={state}>{children}</HydrationBoundary>
      </LocationScopeProvider>
    </SessionProvider>
  );
}
