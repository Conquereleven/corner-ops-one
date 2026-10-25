import { describe, expect, it } from "vitest";
import { permissionsFor } from "@/domain/auth/permissions";
import { getAnalytics, getProfitability } from "@/server/services/analytics";
import { getInventory, recordMovement } from "@/server/services/inventory";
import { getOrder, listOrders, performOrderAction } from "@/server/services/orders";
import { updateSettings } from "@/server/services/settings";
import { inviteMember } from "@/server/services/team";
import { asUser, freshDemoOrder, memberOf, rawAs, system } from "../support/helpers";
import { ORG_A } from "../support/fixtures";

const MARINA = "loc_marina";
const BBAY = "loc_bbay";
const JVC = "loc_jvc";

async function orderAt(locationId: string, statuses: string[] = ["completed"]) {
  return system(async (db) => String((await db`select id from orders where organization_id = ${ORG_A} and location_id = ${locationId} and status = any(${statuses}) order by placed_at desc limit 1`)[0].id));
}

describe("location-scoped access", () => {
  it("a Branch Manager only sees assigned branches, and 'All locations' means those branches", async () => {
    const bm = await memberOf(ORG_A, "branch-manager", "BRANCH_MANAGER", [MARINA, JVC]);
    await asUser(bm, async (ctx) => {
      expect(ctx.allowedLocations.map((l) => l.id).sort()).toEqual([JVC, MARINA]);
      expect(ctx.scope.locationIds.sort()).toEqual([JVC, MARINA]);
      const data = await listOrders(ctx, { range: "today", status: "all" });
      expect(new Set(data.orders.map((o) => o.locationId))).toEqual(new Set([MARINA, JVC]));
    });
    const locs = await rawAs(bm, async (db) => (await db`select distinct location_id from orders`).map((r) => r.location_id).sort());
    expect(locs).toEqual([JVC, MARINA]);
  });

  it("explicitly requesting an unauthorized branch is rejected", async () => {
    const bm = await memberOf(ORG_A, "branch-manager-2", "BRANCH_MANAGER", [MARINA]);
    await expect(asUser(bm, async () => null, { location: BBAY, strict: true })).rejects.toMatchObject({ status: 403 });
    await expect(asUser(bm, (ctx) => listOrders(ctx, { location: BBAY }))).rejects.toMatchObject({ status: 403 });
  });

  it("a Branch Manager cannot read or act on another branch's order", async () => {
    const bm = await memberOf(ORG_A, "branch-manager-3", "BRANCH_MANAGER", [MARINA]);
    const foreign = await orderAt(BBAY, ["new", "accepted", "preparing", "ready", "completed"]);
    await expect(asUser(bm, (ctx) => getOrder(ctx, foreign))).rejects.toMatchObject({ status: 404 });
    await expect(asUser(bm, (ctx) => performOrderAction(ctx, foreign, { action: "cancel", reason: "x" }))).rejects.toMatchObject({ status: 404 });
    const touched = await rawAs(bm, async (db) => (await db`update orders set notes = 'hijack' where id = ${foreign} returning id`).length);
    expect(touched).toBe(0);
  });

  it("inventory is limited to assigned branches and adjustments elsewhere are refused", async () => {
    const bm = await memberOf(ORG_A, "branch-manager-4", "BRANCH_MANAGER", [JVC]);
    const inv = await asUser(bm, (ctx) => getInventory(ctx));
    expect(new Set(inv.items.map((i) => i.locationId))).toEqual(new Set([JVC]));
    await expect(
      asUser(bm, (ctx) => recordMovement(ctx, { inventoryItemId: "inv_marina_chicken", type: "purchase", quantity: 5 })),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("role restrictions", () => {
  it("permission matrix: kitchen staff are limited to kitchen operations", () => {
    const p = permissionsFor("KITCHEN_STAFF");
    expect([...p].sort()).toEqual(["kitchen.view", "orders.progress", "orders.view"]);
    expect(permissionsFor("BRANCH_MANAGER").has("profitability.view")).toBe(false);
    expect(permissionsFor("OPERATIONS_MANAGER").has("settings.manage")).toBe(false);
    expect(permissionsFor("ADMIN", { isDemo: true }).has("team.manage")).toBe(false);
  });

  it("kitchen staff cannot change organization settings (service and database)", async () => {
    const cook = await memberOf(ORG_A, "cook", "KITCHEN_STAFF", [MARINA]);
    await expect(asUser(cook, (ctx) => updateSettings(ctx, { sla: { prepTargetMinutes: 99 } }))).rejects.toMatchObject({ status: 403 });
    const rows = await rawAs(cook, async (db) => (await db`update organization_settings set sla = '{}'::jsonb where organization_id = ${ORG_A} returning 1`).length);
    expect(rows).toBe(0);
  });

  it("kitchen staff cannot see profitability, analytics, adjust stock or invite users", async () => {
    const cook = await memberOf(ORG_A, "cook-2", "KITCHEN_STAFF", [MARINA]);
    await expect(asUser(cook, (ctx) => getProfitability(ctx, "7d"))).rejects.toMatchObject({ status: 403 });
    await expect(asUser(cook, (ctx) => getAnalytics(ctx, "7d"))).rejects.toMatchObject({ status: 403 });
    await expect(asUser(cook, (ctx) => recordMovement(ctx, { inventoryItemId: "inv_marina_chicken", type: "waste", quantity: 1 }))).rejects.toMatchObject({ status: 403 });
    await expect(asUser(cook, (ctx) => inviteMember(ctx, { email: "x@y.com", role: "ADMIN", locationIds: [] }))).rejects.toMatchObject({ status: 403 });
    const audits = await rawAs(cook, async (db) => (await db`select count(*)::int n from audit_logs`)[0].n);
    expect(audits).toBe(0);
  });

  it("kitchen staff can progress orders at their station but not cancel", async () => {
    const cook = await memberOf(ORG_A, "cook-3", "KITCHEN_STAFF", [MARINA]);
    const { id } = await freshDemoOrder(MARINA);
    const res = await asUser(cook, (ctx) => performOrderAction(ctx, id, { action: "accept" }));
    expect(res.order.status).toBe("accepted");
    await expect(asUser(cook, (ctx) => performOrderAction(ctx, id, { action: "cancel" }))).rejects.toMatchObject({ status: 403 });
  });

  it("analytics for non-financial roles omit profitability", async () => {
    const bm = await memberOf(ORG_A, "branch-manager-5", "BRANCH_MANAGER", [MARINA]);
    const data = await asUser(bm, (ctx) => getAnalytics(ctx, "7d"));
    expect(data.profitability).toBeNull();
  });
});
