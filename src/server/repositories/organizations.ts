import type { Location, Organization, Restaurant } from "@/domain/locations/types";
import type { WorkspaceSettings } from "../store/types";
import type { Db } from "../db/client";
import { hhmm, newId, num, optStr, str } from "./mappers";

export type SettingsSection = "sla" | "economics" | "demo";

export interface OrganizationRepository {
  get(): Promise<Organization>;
  restaurant(): Promise<Restaurant>;
  update(patch: { name?: string; legalName?: string | null }): Promise<Organization>;
  settings(): Promise<WorkspaceSettings>;
  /** Writes only the given sections (column privileges allow sla, economics, demo). */
  updateSettings(next: WorkspaceSettings, sections: SettingsSection[]): Promise<void>;
}

export interface LocationRepository {
  /** Locations visible to the caller (RLS limits location-restricted roles). */
  list(): Promise<Location[]>;
  update(id: string, patch: { operatingHours?: { open: string; close: string }; managerName?: string; isOpen?: boolean }): Promise<Location>;
  create(input: { restaurantId: string; name: string; code: string; area: string; address: string; operatingHours: { open: string; close: string }; kitchenCapacity: number; managerName: string }): Promise<Location>;
}

export const mapOrganization = (r: Record<string, unknown>): Organization => ({
  id: str(r.id),
  name: str(r.name),
  slug: str(r.slug),
  currency: str(r.currency),
  timezone: str(r.timezone),
  isDemo: Boolean(r.is_demo),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export const mapLocation = (r: Record<string, unknown>): Location => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  restaurantId: str(r.restaurant_id),
  name: str(r.name),
  code: str(r.code),
  area: str(r.area),
  address: str(r.address),
  operatingHours: { open: hhmm(r.open_time), close: hhmm(r.close_time) },
  kitchenCapacity: num(r.kitchen_capacity),
  managerName: str(r.manager_name),
  isOpen: Boolean(r.is_open),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export function createOrganizationRepository(db: Db, organizationId: string, opts: { financials?: boolean } = {}): OrganizationRepository {
  return {
    async get() {
      const [r] = await db`select * from public.organizations where id = ${organizationId}`;
      if (!r) throw Object.assign(new Error("organization not found"), { code: "P0002" });
      return mapOrganization(r);
    },
    async restaurant() {
      const [r] = await db`select * from public.restaurants where organization_id = ${organizationId} order by created_at limit 1`;
      return {
        id: str(r?.id),
        organizationId,
        name: str(r?.name),
        cuisine: optStr(r?.cuisine) ?? "",
        createdAt: str(r?.created_at),
        updatedAt: str(r?.updated_at),
      };
    },
    async update(patch) {
      const rows = await db`
        update public.organizations set name = coalesce(${patch.name ?? null}, name),
          legal_name = ${patch.legalName === undefined ? db`legal_name` : patch.legalName}
        where id = ${organizationId} returning *`;
      if (!rows.length) throw Object.assign(new Error("organization not updated"), { code: "42501" });
      return mapOrganization(rows[0]);
    },
    async settings() {
      const [r] = await db`select sla, demo from public.organization_settings where organization_id = ${organizationId}`;
      if (!r) throw Object.assign(new Error("settings not found"), { code: "P0002" });
      const economics = opts.financials ? (await db`select public.financial_economics(${organizationId}) as e`)[0].e : null;
      return {
        sla: r.sla as WorkspaceSettings["sla"],
        economics: (economics as WorkspaceSettings["economics"]) ?? null,
        demo: r.demo as WorkspaceSettings["demo"],
        aiProvider: "deterministic",
      };
    },
    async updateSettings(next, sections) {
      const values: Record<string, unknown> = {};
      for (const s of sections) if (next[s] !== null) values[s] = db.json(next[s] as never);
      if (!Object.keys(values).length) return;
      const rows = await db`
        update public.organization_settings set ${db(values)}
        where organization_id = ${organizationId} returning organization_id`;
      if (!rows.length) throw Object.assign(new Error("settings not updated"), { code: "42501" });
    },
  };
}

export function createLocationRepository(db: Db, organizationId: string): LocationRepository {
  return {
    async list() {
      const rows = await db`select * from public.locations where organization_id = ${organizationId} order by created_at, name`;
      return rows.map(mapLocation);
    },
    async update(id, patch) {
      const rows = await db`
        update public.locations set
          open_time = coalesce(${patch.operatingHours?.open ?? null}::time, open_time),
          close_time = coalesce(${patch.operatingHours?.close ?? null}::time, close_time),
          manager_name = coalesce(${patch.managerName ?? null}, manager_name),
          is_open = coalesce(${patch.isOpen ?? null}, is_open)
        where id = ${id} and organization_id = ${organizationId} returning *`;
      if (!rows.length) throw Object.assign(new Error("location not updated"), { code: "42501" });
      return mapLocation(rows[0]);
    },
    async create(input) {
      const [r] = await db`
        insert into public.locations (id, organization_id, restaurant_id, name, code, area, address, open_time, close_time, kitchen_capacity, manager_name)
        values (${newId("loc")}, ${organizationId}, ${input.restaurantId}, ${input.name}, ${input.code}, ${input.area}, ${input.address},
                ${input.operatingHours.open}, ${input.operatingHours.close}, ${input.kitchenCapacity}, ${input.managerName})
        returning *`;
      return mapLocation(r);
    },
  };
}
