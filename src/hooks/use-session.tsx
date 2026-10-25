"use client";

import { createContext, useContext } from "react";
import type { Permission } from "@/domain/auth/permissions";
import type { SessionInfo } from "@/lib/session";

const SessionContext = createContext<SessionInfo | null>(null);

export function SessionProvider({ session, children }: { session: SessionInfo; children: React.ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionInfo {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

/** UI hint only — the server enforces every permission. */
export function useCan(permission: Permission): boolean {
  return useSession().permissions.includes(permission);
}
