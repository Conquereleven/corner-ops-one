import "server-only";
import { authProviderName } from "../config";
import { localAuthProvider } from "./local-provider";
import { supabaseAuthProvider } from "./supabase-provider";
import type { AuthProvider } from "./types";

export function getAuthProvider(): AuthProvider {
  return authProviderName() === "supabase" ? supabaseAuthProvider : localAuthProvider;
}

export type { AuthProvider, SessionUser } from "./types";
