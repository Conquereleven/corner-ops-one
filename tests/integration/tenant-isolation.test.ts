import { describe, expect, it } from "vitest";
import { search } from "@/server/services/search";
import { asUser, memberOf, rawAs, createUser, system } from "../support/helpers";
import { ORG_A, ORG_B } from "../support/fixtures";

const TABLES = [
  "orders", "order_items", "locations", "inventory_items", "inventory_movements", "menu_items", "menu_channel_mappings",
  "channel_connections", "channel_logs", "customers", "organization_settings", "kitchen_tickets", "organization_memberships",
];

async function visibleOrgs(user: Awaited<ReturnType<typeof createUser>>, table: string) {
  return rawAs(user, async (db) => (await db.unsafe(`select distinct organization_id from public.${table}`)).map((r) => String(r.organization_id)));
}

describe("tenant isolation (RLS)", () => {
  it("Organization A sees only its own records; B sees only its own", async () => {
    const a = await memberOf(ORG_A, "owner-a", "OWNER");
    const b = await memberOf(ORG_B, "owner-b", "OWNER");
    for (const table of TABLES) {
      expect(await visibleOrgs(a, table), `org A on ${table}`).toEqual([ORG_A]);
      expect(await visibleOrgs(b, table), `org B on ${table}`).toEqual([ORG_B]);
    }
    const [aCount, bCount] = await Promise.all([
      rawAs(a, async (db) => (await db`select count(*)::int n from orders where organization_id = ${ORG_B}`)[0].n),
      rawAs(b, async (db) => (await db`select count(*)::int n from orders where organization_id = ${ORG_A}`)[0].n),
    ]);
    expect(aCount).toBe(0);
    expect(bCount).toBe(0);
  });

  it("a user with no membership sees nothing", async () => {
    const stranger = await createUser("stranger");
    for (const table of TABLES) expect(await visibleOrgs(stranger, table), table).toEqual([]);
  });

  it("anonymous role has no table access", async () => {
    await expect(
      system(async (db) => {
        await db`set local role anon`;
        return db`select count(*) from public.orders`;
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("Organization A cannot write into Organization B", async () => {
    const a = await memberOf(ORG_A, "writer-a", "OWNER");
    const updated = await rawAs(a, async (db) => (await db`update public.orders set notes = 'x' where organization_id = ${ORG_B} returning id`).length);
    expect(updated).toBe(0);
    await expect(
      rawAs(a, (db) => db`insert into public.domain_events (organization_id, type, aggregate_type, aggregate_id, actor_user_id) values (${ORG_B}, 'order.accepted', 'order', 'x', ${a.id})`),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("search never returns another tenant's records", async () => {
    const a = await memberOf(ORG_A, "searcher-a", "OWNER");
    const results = await asUser(a, (ctx) => search(ctx, "birria"));
    expect(results.orders.length).toBeGreaterThan(0);
    const ids = results.orders.map((o) => o.id);
    const owners = await system(async (db) => (await db`select distinct organization_id from orders where id = any(${ids})`).map((r) => r.organization_id));
    expect(owners).toEqual([ORG_A]);
    expect(results.menu.every((m) => !m.id.startsWith("cnh_"))).toBe(true);
  });
});
