import { permissionsFor, roleSchema, type Permission, type Role } from "@/domain/auth/permissions";
import type { Location, Organization } from "@/domain/locations/types";
import type { SessionUser } from "../auth/types";
import type { Db } from "../db/client";
import type { Actor } from "../db/transaction";
import { ForbiddenError, NoOrganizationError, UnauthenticatedError } from "../errors";
import { createRepositories, type Repositories } from "../repositories";
import { mapLocation, mapOrganization } from "../repositories/organizations";
import { createWorkspaceData, type WorkspaceData } from "./data";

export const ALL = "all" as const;

export interface Scope {
  /** "all" = every location the user may access. */
  key: string;
  locationIds: string[];
  label: string;
}

export interface MembershipSummary {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  isDemo: boolean;
  role: Role;
}

/** Everything a service needs to act on behalf of the signed-in user. */
export interface AppContext {
  user: SessionUser;
  organization: Organization;
  membership: { id: string; role: Role };
  memberships: MembershipSummary[];
  permissions: Set<Permission>;
  allowedLocations: Location[];
  scope: Scope;
  db: Db;
  repos: Repositories;
  data: WorkspaceData;
  actor: Actor;
  now: number;
}

export interface ResolvedIdentity {
  user: SessionUser;
  organization: Organization;
  membership: { id: string; role: Role };
  memberships: MembershipSummary[];
  allowedLocations: Location[];
}

/**
 * Resolve organization, membership and accessible locations for a user. Runs
 * inside a user (RLS) transaction, so it can only ever see what the user may see.
 */
export async function resolveIdentity(
  db: Db,
  user: SessionUser,
  opts: { preferredOrganizationId?: string | null; includeDemo: boolean },
): Promise<ResolvedIdentity> {
  await db`select public.claim_pending_invitations()`;
  const profile = await db`select email, full_name from public.profiles where id = ${user.id}`;
  if (!profile.length) throw new UnauthenticatedError();
  const resolvedUser: SessionUser = { ...user, email: String(profile[0].email || user.email), name: (profile[0].full_name as string) ?? user.name };

  const rows = await db`
    select m.id as membership_id, m.role, o.*
    from public.organization_memberships m join public.organizations o on o.id = m.organization_id
    where m.user_id = ${user.id} and m.status = 'active'
      -- A shared demo identity never acts outside demo organizations (also enforced by every RLS helper).
      and (o.is_demo or not private.is_demo_identity(m.user_id))
    order by o.is_demo, m.created_at`;
  const memberships: (MembershipSummary & { org: Organization })[] = rows
    .map((r) => ({
      membershipId: String(r.membership_id),
      organizationId: String(r.id),
      organizationName: String(r.name),
      isDemo: Boolean(r.is_demo),
      role: roleSchema.parse(r.role),
      org: mapOrganization(r),
    }))
    .filter((m) => opts.includeDemo || !m.isDemo);
  if (!memberships.length) throw new NoOrganizationError();

  const chosen = memberships.find((m) => m.organizationId === opts.preferredOrganizationId) ?? memberships[0];
  const locations = (await db`select * from public.locations where organization_id = ${chosen.organizationId} order by created_at, name`).map(mapLocation);

  return {
    user: resolvedUser,
    organization: chosen.org,
    membership: { id: chosen.membershipId, role: chosen.role },
    memberships: memberships.map((m) => ({ membershipId: m.membershipId, organizationId: m.organizationId, organizationName: m.organizationName, isDemo: m.isDemo, role: m.role })),
    allowedLocations: locations,
  };
}

/** Narrow the requested location to what the user may access. */
export function resolveScope(allowed: Location[], requested: string | null | undefined, opts: { strict?: boolean } = {}): Scope {
  const all: Scope = { key: ALL, locationIds: allowed.map((l) => l.id), label: "All locations" };
  if (!requested || requested === ALL) return all;
  const loc = allowed.find((l) => l.id === requested);
  if (!loc) {
    if (opts.strict) throw new ForbiddenError("You don't have access to that location.");
    return all;
  }
  return { key: loc.id, locationIds: [loc.id], label: loc.name };
}

export function buildAppContext(db: Db, identity: ResolvedIdentity, scope: Scope, now = Date.now()): AppContext {
  const permissions = permissionsFor(identity.membership.role, { isDemo: identity.organization.isDemo });
  // The database enforces the same rule; this only avoids calls that would be refused.
  const repos = createRepositories(db, identity.organization.id, { financials: permissions.has("profitability.view") });
  const ctx: AppContext = {
    ...identity,
    permissions,
    scope,
    db,
    repos,
    data: undefined as unknown as WorkspaceData,
    actor: { kind: "user", userId: identity.user.id },
    now,
  };
  ctx.data = createWorkspaceData(ctx);
  return ctx;
}

export function requirePermission(ctx: Pick<AppContext, "permissions">, permission: Permission) {
  if (!ctx.permissions.has(permission)) throw new ForbiddenError();
}

export function requireLocationAccess(ctx: Pick<AppContext, "allowedLocations">, locationId: string) {
  if (!ctx.allowedLocations.some((l) => l.id === locationId)) throw new ForbiddenError("You don't have access to that location.");
}

export function inScope(scope: Scope, locationId: string): boolean {
  return scope.locationIds.includes(locationId);
}
