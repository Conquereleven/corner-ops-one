import { describe, expect, it } from "vitest";
import { withUserTransaction } from "@/server/db/transaction";
import { resolveIdentity } from "@/server/context/app-context";
import { injectDemoOrder, tickDemoWorkspace } from "@/server/demo/simulation";
import { resetDemoWorkspace } from "@/server/demo/workspace";
import { authorizeDemoAction } from "@/server/services/settings";
import { getTeam, inviteMember, updateMember } from "@/server/services/team";
import { asUser, createUser, memberOf, system } from "../support/helpers";
import { ORG_A, ORG_B } from "../support/fixtures";

const count = (org: string) => system(async (db) => (await db`select count(*)::int n from orders where organization_id = ${org}`)[0].n as number);

describe("demo isolation", () => {
  it("simulation only ever touches the demo organization", async () => {
    const bBefore = await count(ORG_B);
    await tickDemoWorkspace(ORG_B, Date.now() + 60_000);
    await expect(injectDemoOrder(ORG_B, { channel: "talabat", locationId: "cnh_loc_marina" })).rejects.toThrow();
    expect(await count(ORG_B)).toBe(bBefore);

    const aBefore = await count(ORG_A);
    await tickDemoWorkspace(ORG_A, Date.now() + 10 * 60_000);
    expect(await count(ORG_A)).toBeGreaterThanOrEqual(aBefore);
  });

  it("production organizations cannot use demo actions", async () => {
    const owner = await memberOf(ORG_B, "owner-b-demo", "OWNER");
    await expect(asUser(owner, async (ctx) => authorizeDemoAction(ctx, { action: "inject", channel: "talabat" }))).rejects.toMatchObject({ status: 403 });
    await expect(asUser(owner, async (ctx) => authorizeDemoAction(ctx, { action: "reset", confirm: "RESET" }))).rejects.toMatchObject({ status: 403 });
  });

  it("reset restores the demo to its seeded state and leaves other tenants untouched", async () => {
    const bBefore = await count(ORG_B);
    await injectDemoOrder(ORG_A, { channel: "talabat", locationId: "loc_marina" });
    await resetDemoWorkspace({ kind: "system", label: "test" });
    const injected = await system(async (db) => (await db`select count(*)::int n from orders where organization_id = ${ORG_A} and source = 'mock'`)[0].n);
    expect(injected).toBe(0);
    expect(await count(ORG_A)).toBeGreaterThan(4000);
    expect(await count(ORG_B)).toBe(bBefore);
    const [ev] = await system((db) => db`select type from domain_events where organization_id = ${ORG_A} and type = 'demo.reset'`);
    expect(ev.type).toBe("demo.reset");
  });

  it("reset keeps every other member's role and location grants (nobody is promoted)", async () => {
    const bm = await memberOf(ORG_A, "demo-bm-reset", "BRANCH_MANAGER", ["loc_jvc"]);
    const cook = await memberOf(ORG_A, "demo-cook-reset", "KITCHEN_STAFF", ["loc_marina"]);
    await resetDemoWorkspace({ kind: "system", label: "test" });
    const rows = await system((db) => db`
      select m.user_id, m.role, array(select ml.location_id from membership_locations ml where ml.membership_id = m.id order by 1) as locs
      from organization_memberships m where m.organization_id = ${ORG_A} and m.user_id = any(${[bm.id, cook.id]})`);
    const byUser = Object.fromEntries(rows.map((r) => [r.user_id, { role: r.role, locs: r.locs }]));
    expect(byUser[bm.id]).toEqual({ role: "BRANCH_MANAGER", locs: ["loc_jvc"] });
    expect(byUser[cook.id]).toEqual({ role: "KITCHEN_STAFF", locs: ["loc_marina"] });
  });
});

describe("team management", () => {
  it("an admin cannot grant OWNER; an owner can invite with locations and the invite is claimed on sign-in", async () => {
    const admin = await memberOf(ORG_B, "admin-b", "ADMIN");
    await expect(asUser(admin, (ctx) => inviteMember(ctx, { email: "x-owner@test.cornerops.one", role: "OWNER", locationIds: [] }))).rejects.toMatchObject({ status: 403 });

    const owner = await memberOf(ORG_B, "owner-b-team", "OWNER");
    const email = `chef.${Date.now()}@test.cornerops.one`;
    const invite = await asUser(owner, (ctx) => inviteMember(ctx, { email, role: "KITCHEN_STAFF", locationIds: ["cnh_loc_jvc"] }));
    expect(invite.status).toBe("invited");

    const chef = await createUser("chef", email);
    const identity = await withUserTransaction(chef.id, (db) => resolveIdentity(db, chef, { includeDemo: true }));
    expect(identity.organization.id).toBe(ORG_B);
    expect(identity.membership.role).toBe("KITCHEN_STAFF");
    expect(identity.allowedLocations.map((l) => l.id)).toEqual(["cnh_loc_jvc"]);

    const [audit] = await system((db) => db`select actor_user_id, after_data from audit_logs where entity_id = ${invite.id} and action = 'membership.invited'`);
    expect(audit.actor_user_id).toBe(owner.id);
  });

  it("disabling a membership removes access immediately", async () => {
    const owner = await memberOf(ORG_B, "owner-b-disable", "OWNER");
    const staff = await memberOf(ORG_B, "staff-b", "BRANCH_MANAGER", ["cnh_loc_marina"]);
    const team = await asUser(owner, (ctx) => getTeam(ctx), { orgId: ORG_B });
    const m = team.members.find((x) => x.userId === staff.id)!;
    await asUser(owner, (ctx) => updateMember(ctx, m.id, { status: "disabled" }), { orgId: ORG_B });
    await expect(withUserTransaction(staff.id, (db) => resolveIdentity(db, staff, { includeDemo: true }))).rejects.toMatchObject({ status: 403 });
  });

  it("the last owner cannot be demoted, and nobody can edit their own membership", async () => {
    const solo = await createUser("solo-owner");
    const orgId = await withUserTransaction(solo.id, async (db) => {
      const [r] = await db`select public.create_organization('Solo Kitchen', ${"solo-" + Date.now()}, 'Asia/Dubai', 'AED', ${db.json({ sla: {}, economics: {}, demo: { enabled: false } })}) as id`;
      return String(r.id);
    });
    const admin = await memberOf(orgId, "solo-admin", "ADMIN");
    const team = await asUser(solo, (ctx) => getTeam(ctx), { orgId });
    const ownerMembership = team.members.find((x) => x.userId === solo.id)!;
    await expect(asUser(solo, (ctx) => updateMember(ctx, ownerMembership.id, { role: "ADMIN" }), { orgId })).rejects.toMatchObject({ status: 403 });
    await expect(asUser(admin, (ctx) => updateMember(ctx, ownerMembership.id, { status: "disabled" }), { orgId })).rejects.toMatchObject({ status: 403 });
  });
});
