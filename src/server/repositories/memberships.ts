import type { Role } from "@/domain/auth/permissions";
import type { Db } from "../db/client";
import { optStr, str } from "./mappers";

export type MembershipStatus = "invited" | "active" | "disabled";

export interface Membership {
  id: string;
  organizationId: string;
  userId: string | null;
  invitedEmail: string | null;
  email: string | null;
  fullName: string | null;
  role: Role;
  status: MembershipStatus;
  locationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MembershipRepository {
  list(): Promise<Membership[]>;
  findById(id: string): Promise<Membership | null>;
  invite(input: { email: string; role: Role; locationIds: string[]; invitedBy: string }): Promise<Membership>;
  update(id: string, patch: { role?: Role; status?: MembershipStatus }): Promise<Membership>;
  setLocations(id: string, locationIds: string[]): Promise<void>;
}

const SELECT = `
  select m.*, p.email as profile_email, p.full_name,
    coalesce((select array_agg(ml.location_id order by ml.location_id) from public.membership_locations ml where ml.membership_id = m.id), '{}') as location_ids
  from public.organization_memberships m
  left join public.profiles p on p.id = m.user_id`;

export const mapMembership = (r: Record<string, unknown>): Membership => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  userId: optStr(r.user_id) ?? null,
  invitedEmail: optStr(r.invited_email) ?? null,
  email: optStr(r.profile_email) ?? optStr(r.invited_email) ?? null,
  fullName: optStr(r.full_name) ?? null,
  role: str(r.role) as Role,
  status: str(r.status) as MembershipStatus,
  locationIds: (r.location_ids as string[]) ?? [],
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export function createMembershipRepository(db: Db, organizationId: string): MembershipRepository {
  return {
    async list() {
      const rows = await db`${db.unsafe(SELECT)} where m.organization_id = ${organizationId} order by m.created_at`;
      return rows.map(mapMembership);
    },
    async findById(id) {
      const rows = await db`${db.unsafe(SELECT)} where m.organization_id = ${organizationId} and m.id = ${id}`;
      return rows[0] ? mapMembership(rows[0]) : null;
    },
    async invite({ email, role, locationIds, invitedBy }) {
      const [r] = await db`
        insert into public.organization_memberships (organization_id, invited_email, role, status, invited_by)
        values (${organizationId}, ${email.toLowerCase()}, ${role}, 'invited', ${invitedBy})
        returning id`;
      await this.setLocations(str(r.id), locationIds);
      return (await this.findById(str(r.id)))!;
    },
    async update(id, patch) {
      const rows = await db`
        update public.organization_memberships set role = coalesce(${patch.role ?? null}, role), status = coalesce(${patch.status ?? null}, status)
        where id = ${id} and organization_id = ${organizationId} returning id`;
      if (!rows.length) throw Object.assign(new Error("membership not updated"), { code: "42501" });
      return (await this.findById(id))!;
    },
    async setLocations(id, locationIds) {
      await db`delete from public.membership_locations where membership_id = ${id}`;
      if (locationIds.length) {
        await db`insert into public.membership_locations ${db(
          locationIds.map((locationId) => ({ membership_id: id, location_id: locationId, organization_id: organizationId })),
        )}`;
      }
    },
  };
}
