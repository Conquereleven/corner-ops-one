import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Permission } from "@/domain/auth/permissions";
import { getAuthProvider, type SessionUser } from "../auth";
import { appMode } from "../config";
import { withUserTransaction } from "../db/transaction";
import { tickDemoWorkspace } from "../demo/simulation";
import { UnauthenticatedError } from "../errors";
import { buildAppContext, requirePermission, resolveIdentity, resolveScope, type AppContext, type ResolvedIdentity } from "./app-context";

export const ORG_COOKIE = "co_org";
export const LOCATION_COOKIE = "co_location";

/** Per-request (React cache) session lookup. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => getAuthProvider().getUser());

const getIdentity = cache(async (user: SessionUser, preferredOrganizationId: string | null): Promise<ResolvedIdentity> =>
  withUserTransaction(user.id, (db) => resolveIdentity(db, user, { preferredOrganizationId, includeDemo: appMode() === "demo" })),
);

export async function currentIdentity(): Promise<ResolvedIdentity> {
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError();
  const store = await cookies();
  return getIdentity(user, store.get(ORG_COOKIE)?.value ?? null);
}

export interface ContextOptions {
  /** Explicit location from the request; falls back to the location cookie. */
  location?: string | null;
  /** Reject (403) an explicitly requested location the user can't access. */
  strictLocation?: boolean;
  permission?: Permission;
}

/**
 * Run `fn` with the authenticated AppContext inside a Row-Level-Security
 * transaction. Organization, role and locations are derived server-side from
 * the session — never from client-supplied ids.
 */
export async function withAppContext<T>(opts: ContextOptions, fn: (ctx: AppContext) => Promise<T>): Promise<T> {
  const identity = await currentIdentity();
  if (identity.organization.isDemo) await tickDemoWorkspace(identity.organization.id);
  const store = await cookies();
  const explicit = opts.location !== undefined && opts.location !== null;
  const requested = explicit ? opts.location : decodeURIComponent(store.get(LOCATION_COOKIE)?.value ?? "all");
  const scope = resolveScope(identity.allowedLocations, requested, { strict: explicit && opts.strictLocation });
  return withUserTransaction(identity.user.id, async (db) => {
    const ctx = buildAppContext(db, identity, scope);
    if (opts.permission) requirePermission(ctx, opts.permission);
    return fn(ctx);
  });
}
