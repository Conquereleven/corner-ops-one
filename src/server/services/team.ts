import "server-only";
import { z } from "zod";
import { assignableRoles, isLocationRestricted, roleSchema, type Role } from "@/domain/auth/permissions";
import { requirePermission, type AppContext } from "../context/app-context";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import type { Membership } from "../repositories/memberships";

export async function getTeam(ctx: AppContext) {
  requirePermission(ctx, "team.view");
  const members = await ctx.repos.memberships.list();
  return {
    members,
    locations: ctx.allowedLocations.map((l) => ({ id: l.id, name: l.name })),
    assignableRoles: ctx.permissions.has("team.manage") ? assignableRoles(ctx.membership.role) : [],
    canManage: ctx.permissions.has("team.manage"),
    currentMembershipId: ctx.membership.id,
  };
}
export type TeamData = Awaited<ReturnType<typeof getTeam>>;

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: roleSchema,
  locationIds: z.array(z.string()).max(200).default([]),
});

export const membershipPatchSchema = z
  .object({
    role: roleSchema,
    status: z.enum(["active", "disabled"]),
    locationIds: z.array(z.string()).max(200),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

function checkRoleAndLocations(ctx: AppContext, role: Role, locationIds: string[]) {
  if (!assignableRoles(ctx.membership.role).includes(role)) throw new ForbiddenError("You can't assign that role.");
  const allowed = new Set(ctx.allowedLocations.map((l) => l.id));
  if (locationIds.some((id) => !allowed.has(id))) throw new ForbiddenError("You can't grant access to that location.");
  if (isLocationRestricted(role) && locationIds.length === 0) throw new ConflictError("Branch managers and kitchen staff need at least one location.");
}

const view = (m: Membership) => ({ role: m.role, status: m.status, locationIds: m.locationIds, email: m.email });

/**
 * Invite a teammate. Creates a pending membership that is claimed when a user
 * with that (confirmed) email signs in. Email delivery is not part of v0.2 —
 * share the sign-up link with the invitee.
 */
export async function inviteMember(ctx: AppContext, input: z.infer<typeof inviteSchema>) {
  requirePermission(ctx, "team.manage");
  const locationIds = isLocationRestricted(input.role) ? input.locationIds : [];
  checkRoleAndLocations(ctx, input.role, locationIds);
  const existing = (await ctx.repos.memberships.list()).find((m) => m.email?.toLowerCase() === input.email);
  if (existing) throw new ConflictError("This person is already a member or has a pending invitation.");
  const m = await ctx.repos.memberships.invite({ email: input.email, role: input.role, locationIds, invitedBy: ctx.user.id });
  await ctx.repos.events.append({ type: "membership.invited", aggregateType: "membership", aggregateId: m.id, payload: { email: input.email, role: input.role, locationIds } }, ctx.actor);
  return m;
}

export async function updateMember(ctx: AppContext, id: string, patch: z.infer<typeof membershipPatchSchema>) {
  requirePermission(ctx, "team.manage");
  const before = await ctx.repos.memberships.findById(id);
  if (!before) throw new NotFoundError("Member");
  if (before.id === ctx.membership.id) throw new ForbiddenError("You can't change your own role or access.");
  if (before.role === "OWNER" && ctx.membership.role !== "OWNER") throw new ForbiddenError("Only an owner can change another owner.");

  const role = patch.role ?? before.role;
  const locationIds = isLocationRestricted(role) ? (patch.locationIds ?? before.locationIds) : [];
  if (patch.role || patch.locationIds) checkRoleAndLocations(ctx, role, locationIds);

  const members = await ctx.repos.memberships.list();
  const activeOwners = members.filter((m) => m.role === "OWNER" && m.status === "active");
  const removesOwner = before.role === "OWNER" && (role !== "OWNER" || patch.status === "disabled");
  if (removesOwner && activeOwners.length <= 1) throw new ConflictError("An organization must keep at least one active owner.");
  if (patch.status === "active" && before.status === "invited") throw new ConflictError("Invitations become active when the invitee signs in.");

  let after = before;
  if (patch.role || (patch.status && before.status !== "invited")) {
    after = await ctx.repos.memberships.update(id, { role: patch.role, status: before.status === "invited" ? undefined : patch.status });
  }
  if (patch.locationIds || patch.role) {
    await ctx.repos.memberships.setLocations(id, locationIds);
    after = (await ctx.repos.memberships.findById(id))!;
  }
  const action =
    patch.status && patch.status !== before.status ? (patch.status === "disabled" ? "membership.disabled" : "membership.enabled")
    : patch.role && patch.role !== before.role ? "membership.role_changed"
    : "membership.locations_changed";
  await ctx.repos.events.append({ type: "membership.updated", aggregateType: "membership", aggregateId: id, payload: { action, ...view(after) } }, ctx.actor);
  return after;
}

export const organizationPatchSchema = z.object({ name: z.string().trim().min(2).max(120) });

export async function updateOrganization(ctx: AppContext, patch: z.infer<typeof organizationPatchSchema>) {
  requirePermission(ctx, "organization.manage");
  // Audited by the database trigger on organizations.
  return ctx.repos.organization.update({ name: patch.name });
}

export async function getActivity(ctx: AppContext, limit = 100) {
  requirePermission(ctx, "audit.view");
  return ctx.repos.audit.list({ limit });
}
export type ActivityData = Awaited<ReturnType<typeof getActivity>>;
