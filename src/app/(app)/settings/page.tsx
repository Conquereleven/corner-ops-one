import { HydrationBoundary } from "@tanstack/react-query";
import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";
import { queryKeys } from "@/lib/query-keys";
import { prefetch } from "@/server/prefetch";
import { getSettings } from "@/server/services/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const state = await prefetch([{ queryKey: queryKeys.settings(), queryFn: getSettings }]);
  return (
    <HydrationBoundary state={state}>
      <SettingsView />
    </HydrationBoundary>
  );
}
