import { z } from "zod";

/**
 * Central authorization model. UI and API code ask `can(role, permission)`;
 * nothing else should compare role names. Row Level Security in Postgres
 * enforces the same boundaries at the database (see RLS v2 migration).
 */
export const ROLES = ["OWNER", "ADMIN", "OPERATIONS_MANAGER", "BRANCH_MANAGER", "KITCHEN_STAFF"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  OPERATIONS_MANAGER: "Operations manager",
  BRANCH_MANAGER: "Branch manager",
  KITCHEN_STAFF: "Kitchen staff",
};

export const PERMISSIONS = [
  "overview.view",
  "orders.view",
  "orders.progress", // accept / prepare / ready / picked up / complete
  "orders.cancel",
  "kitchen.view",
  "menu.view",
  "menu.manage",
  "inventory.view",
  "inventory.manage",
  "channels.view",
  "channels.manage",
  "analytics.view",
  "profitability.view",
  "ai.view",
  "alerts.view",
  "locations.view",
  "locations.manage",
  "settings.view",
  "settings.manage",
  "organization.manage",
  "team.view",
  "team.manage",
  "audit.view",
  "demo.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OPERATIONS: Permission[] = [
  "overview.view", "orders.view", "orders.progress", "orders.cancel", "kitchen.view",
  "menu.view", "inventory.view", "inventory.manage", "channels.view", "analytics.view",
  "ai.view", "alerts.view", "locations.view", "settings.view",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  OPERATIONS_MANAGER: [...OPERATIONS, "menu.manage", "channels.manage", "profitability.view", "locations.manage", "demo.manage"],
  BRANCH_MANAGER: OPERATIONS,
  KITCHEN_STAFF: ["kitchen.view", "orders.view", "orders.progress"],
};

/** Roles that see every location; the others only their granted locations. */
export const ORG_WIDE_ROLES: readonly Role[] = ["OWNER", "ADMIN", "OPERATIONS_MANAGER"];

export function permissionsFor(role: Role, opts: { isDemo?: boolean } = {}): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  if (opts.isDemo) {
    // The demo workspace is shared: nobody can change its team or identity.
    set.delete("team.manage");
    set.delete("organization.manage");
  } else {
    set.delete("demo.manage");
  }
  return set;
}

export function can(role: Role, permission: Permission, opts?: { isDemo?: boolean }): boolean {
  return permissionsFor(role, opts).has(permission);
}

export function isLocationRestricted(role: Role): boolean {
  return !ORG_WIDE_ROLES.includes(role);
}

/** Which roles an actor may assign. Only an OWNER can grant or modify OWNER. */
export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole === "OWNER") return [...ROLES];
  if (actorRole === "ADMIN") return ROLES.filter((r) => r !== "OWNER");
  return [];
}

/** Where a role lands after sign-in. */
export function homePathFor(role: Role): string {
  return role === "KITCHEN_STAFF" ? "/kitchen" : "/overview";
}
