import type { Role } from "@/domain/auth/permissions";
import type { SessionUser } from "@/server/auth/types";
import { buildAppContext, resolveIdentity, resolveScope, type AppContext } from "@/server/context/app-context";
import type { Db } from "@/server/db/client";
import { withSystemTransaction, withUserTransaction } from "@/server/db/transaction";

let counter = 0;

/** Create an auth user (local stand-in for Supabase Auth) and return it. */
export async function createUser(label: string, email?: string): Promise<SessionUser> {
  counter += 1;
  const address = email ?? `${label}.${Date.now()}.${counter}@test.cornerops.one`;
  return withSystemTransaction(async (db) => {
    const [r] = await db`
      insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
      values (${address}, extensions.crypt('Passw0rd!', extensions.gen_salt('bf', 4)), now(), ${db.json({ full_name: label })})
      returning id, email`;
    return { id: String(r.id), email: String(r.email), name: label };
  });
}

export async function addMember(orgId: string, user: SessionUser, role: Role, locationIds: string[] = []) {
  return withSystemTransaction(async (db) => {
    const [m] = await db`
      insert into public.organization_memberships (organization_id, user_id, role, status) values (${orgId}, ${user.id}, ${role}, 'active') returning id`;
    for (const loc of locationIds) {
      await db`insert into public.membership_locations (membership_id, location_id, organization_id) values (${m.id}, ${loc}, ${orgId})`;
    }
    return String(m.id);
  });
}

export async function memberOf(orgId: string, label: string, role: Role, locationIds: string[] = []) {
  const user = await createUser(label);
  await addMember(orgId, user, role, locationIds);
  return user;
}

/** Run `fn` exactly as an API request would: RLS transaction + resolved AppContext. */
export async function asUser<T>(
  user: SessionUser,
  fn: (ctx: AppContext, db: Db) => Promise<T>,
  opts: { orgId?: string; location?: string; strict?: boolean } = {},
): Promise<T> {
  const identity = await withUserTransaction(user.id, (db) => resolveIdentity(db, user, { preferredOrganizationId: opts.orgId ?? null, includeDemo: true }));
  return withUserTransaction(user.id, async (db) => {
    const ctx = buildAppContext(db, identity, resolveScope(identity.allowedLocations, opts.location, { strict: opts.strict }));
    return fn(ctx, db);
  }).catch((err) => {
    const cause = (err as { cause?: { message?: string; query?: string } }).cause;
    if (process.env.DEBUG_DB && cause) console.error("[db-cause]", cause.message, "::", cause.query?.replace(/\s+/g, " ").slice(0, 240));
    throw err;
  });
}

/** Raw SQL as the authenticated user (RLS applies, no application checks). */
export function rawAs<T>(user: SessionUser, fn: (db: Db) => Promise<T>) {
  return withUserTransaction(user.id, fn);
}

export function system<T>(fn: (db: Db) => Promise<T>) {
  return withSystemTransaction(fn);
}

/** Create a brand-new order in the Demo Workspace through the Talabat mock adapter pipeline. */
export async function freshDemoOrder(locationId = "loc_marina", channel: "talabat" | "deliveroo" | "direct" = "talabat") {
  const { injectDemoOrder } = await import("@/server/demo/simulation");
  const res = await injectDemoOrder("org_cornerops_demo", { channel, locationId });
  if (!res.order) throw new Error(`could not create demo order: ${JSON.stringify(res)}`);
  return res.order;
}

/**
 * Affected-row count of an unauthorized write attempt, treating "permission
 * denied" (403) as zero rows. Any other error is re-thrown. Callers must still
 * verify the target data is unchanged.
 */
export async function rowsOrDenied(attempt: () => Promise<number>): Promise<number> {
  try {
    return await attempt();
  } catch (err) {
    if ((err as { status?: number }).status === 403) return 0;
    throw err;
  }
}
