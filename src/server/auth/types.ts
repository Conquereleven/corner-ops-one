export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Identity provider boundary. Supabase Auth in hosted environments; a local
 * stand-in for development and tests. Both resolve to auth.users ids, which
 * is what memberships and RLS key on.
 */
export interface AuthProvider {
  readonly name: "supabase" | "local";
  getUser(): Promise<SessionUser | null>;
  signInWithPassword(email: string, password: string): Promise<SessionUser>;
  signUp(input: { email: string; password: string; fullName: string }): Promise<{ user: SessionUser | null; confirmationRequired: boolean }>;
  signOut(): Promise<void>;
}
