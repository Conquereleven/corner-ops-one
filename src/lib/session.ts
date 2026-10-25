import type { Permission, Role } from "@/domain/auth/permissions";

/** Client-safe description of the signed-in session (no secrets, no tokens). */
export interface SessionInfo {
  user: { id: string; name: string | null; email: string };
  organization: { id: string; name: string; isDemo: boolean; timezone: string; currency: string };
  role: Role;
  permissions: Permission[];
  memberships: { organizationId: string; organizationName: string; isDemo: boolean; role: Role }[];
  locations: { id: string; name: string; code: string }[];
  scope: string;
  appMode: "demo" | "production";
}
