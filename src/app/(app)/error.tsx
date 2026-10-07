"use client";

import { ErrorState } from "@/components/shared/states";

export default function WorkspaceError({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState error={error} onRetry={reset} className="mt-10" />;
}
