import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ConfigurationError, ConflictError, UnauthenticatedError } from "../errors";
import type { AuthProvider, SessionUser } from "./types";

/**
 * Supabase Auth (email + password). Session cookies are managed by @supabase/ssr
 * and refreshed in the proxy. Only the publishable (anon) key is used here —
 * the service-role key never reaches this code path or the browser.
 *
 * STATUS: implemented against the documented @supabase/ssr API but NOT VERIFIED
 * against a hosted CornerOps One Supabase project (none is provisioned yet).
 */
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ConfigurationError("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for AUTH_PROVIDER=supabase.");
  return { url, key };
}

async function client() {
  const { url, key } = supabaseEnv();
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

const toUser = (u: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }): SessionUser => ({
  id: u.id,
  email: u.email ?? "",
  name: (u.user_metadata?.full_name as string | undefined) ?? null,
});

export const supabaseAuthProvider: AuthProvider = {
  name: "supabase",
  async getUser() {
    const supabase = await client();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return toUser(data.user);
  },
  async signInWithPassword(email, password) {
    const supabase = await client();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new UnauthenticatedError("Email or password is incorrect.");
    return toUser(data.user);
  },
  async signUp({ email, password, fullName }) {
    const supabase = await client();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) throw new ConflictError(error.message);
    return { user: data.session && data.user ? toUser(data.user) : null, confirmationRequired: !data.session };
  },
  async signOut() {
    const supabase = await client();
    await supabase.auth.signOut();
  },
};
