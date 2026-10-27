import "server-only";
import { demoConfig } from "../config";
import type { Db } from "../db/client";
import { withSystemTransaction } from "../db/transaction";

/**
 * Register a shared demo sign-in. The database then (a) quarantines any
 * production membership or invitation it still holds — e.g. rows left over
 * from a v0.2.0 database — and (b) never counts its memberships outside demo
 * organizations. Idempotent.
 */
export async function registerDemoIdentity(db: Db, userId: string) {
  await db`insert into public.demo_identities (user_id) values (${userId}) on conflict do nothing`;
}

export function isDemoEmail(email: string | null | undefined) {
  return !!email && email.trim().toLowerCase() === demoConfig().email;
}

const registered = new Set<string>();

/**
 * Called before a session's identity is resolved: a user signed in with the
 * configured demo email is registered (system transaction, never nested in a
 * user transaction) even if they used a password instead of "Enter Demo Workspace".
 */
export async function ensureDemoIdentityForSession(user: { id: string; email?: string | null }) {
  if (!isDemoEmail(user.email) || registered.has(user.id)) return;
  await withSystemTransaction((db) => registerDemoIdentity(db, user.id));
  registered.add(user.id);
}
