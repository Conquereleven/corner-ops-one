import { HydrationBoundary } from "@tanstack/react-query";
import { AppShell } from "@/components/shell/app-shell";
import { LocationScopeProvider } from "@/hooks/use-location-scope";
import { queryKeys } from "@/lib/query-keys";
import { getServerScope, prefetch } from "@/server/prefetch";
import { getLocationDirectory } from "@/server/services/locations";
import { getSystemStatus } from "@/server/services/system";

export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const scope = await getServerScope();
  const state = await prefetch([
    { queryKey: queryKeys.directory(), queryFn: getLocationDirectory },
    { queryKey: queryKeys.status(scope), queryFn: () => getSystemStatus(scope) },
  ]);
  return (
    <LocationScopeProvider initialScope={scope}>
      <HydrationBoundary state={state}>
        <AppShell>{children}</AppShell>
      </HydrationBoundary>
    </LocationScopeProvider>
  );
}
