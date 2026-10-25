import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";
import { queryKeys } from "@/lib/query-keys";
import { Forbidden } from "@/components/shared/forbidden";
import { loadPage } from "@/server/page";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const page = await loadPage({ permission: "settings.view" }, (ctx) => [{ queryKey: queryKeys.settings(), queryFn: () => getSettings(ctx) }]);
  if ("forbidden" in page) return <Forbidden message={page.forbidden} />;
  return (
    <HydrationBoundary state={page.state}>
      <SettingsView />
    </HydrationBoundary>
  );
}
