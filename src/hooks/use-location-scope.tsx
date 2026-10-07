"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export const LOCATION_COOKIE = "co_location";

interface LocationScopeValue {
  scope: string;
  setScope: (scope: string) => void;
}

const LocationScopeContext = createContext<LocationScopeValue | null>(null);

export function LocationScopeProvider({ initialScope, children }: { initialScope: string; children: React.ReactNode }) {
  const [scope, setScopeState] = useState(initialScope);
  const setScope = useCallback((next: string) => {
    setScopeState(next);
    document.cookie = `${LOCATION_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  }, []);
  const value = useMemo(() => ({ scope, setScope }), [scope, setScope]);
  return <LocationScopeContext.Provider value={value}>{children}</LocationScopeContext.Provider>;
}

export function useLocationScope() {
  const ctx = useContext(LocationScopeContext);
  if (!ctx) throw new Error("useLocationScope must be used inside LocationScopeProvider");
  return ctx;
}
