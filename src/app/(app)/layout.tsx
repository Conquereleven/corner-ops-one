import { HydrationBoundary } from "@tanstack/react-query";
import { AppShell } from "@/components/shell/app-shell";
import { SessionProvider } from "@/hooks/use-session";
import { LocationScopeProvider } from "@/hooks/use-location-scope";
import { queryKeys } from "@/lib/query-keys";
import { loadShell } from "@/server/page";
import { getLocationDirectory } from "@/server/services/locations";
import { getSystemStatus } from "@/server/services/system";

export default async function WorkspaceLayout({ children }: LayoutProps<"/">) {
  const { session, state } = await loadShell((ctx) => [
    { queryKey: queryKeys.directory(), queryFn: () => getLocationDirectory(ctx) },
    { queryKey: queryKeys.status(ctx.scope.key), queryFn: () => getSystemStatus(ctx) },
  ]);
  return (
    <SessionProvider session={session}>
      <LocationScopeProvider initialScope={session.scope}>
        <HydrationBoundary state={state}>
          <AppShell>{children}</AppShell>
        </HydrationBoundary>
      </LocationScopeProvider>
    </SessionProvider>
  );
}
