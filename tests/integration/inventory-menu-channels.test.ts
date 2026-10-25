import { describe, expect, it } from "vitest";
import { runConnectionAction } from "@/server/services/channels";
import { recordMovement } from "@/server/services/inventory";
import { updateMenuItem } from "@/server/services/menu";
import { updateSettings } from "@/server/services/settings";
import { asUser, memberOf, system } from "../support/helpers";
import { ORG_A } from "../support/fixtures";

describe("inventory", () => {
  it("a movement persists with actor, reason, location and creates audit + event", async () => {
    const bm = await memberOf(ORG_A, "bm-inv", "BRANCH_MANAGER", ["loc_jvc"]);
    const [before] = await system((db) => db`select quantity from inventory_items where id = 'inv_jvc_hibiscus'`);
    await asUser(bm, (ctx) => recordMovement(ctx, { inventoryItemId: "inv_jvc_hibiscus", type: "purchase", quantity: 4, note: "Emergency delivery" }));
    const [after] = await system((db) => db`select quantity from inventory_items where id = 'inv_jvc_hibiscus'`);
    expect(Number(after.quantity)).toBeCloseTo(Number(before.quantity) + 4, 2);
    const [mov] = await system((db) => db`select * from inventory_movements where inventory_item_id = 'inv_jvc_hibiscus' and type = 'purchase' order by created_at desc limit 1`);
    expect(mov).toMatchObject({ organization_id: ORG_A, location_id: "loc_jvc", actor_user_id: bm.id, reason: "Emergency delivery" });
    expect(Number(mov.quantity)).toBe(4);
    const [audit] = await system((db) => db`select * from audit_logs where entity_id = 'inv_jvc_hibiscus' and action = 'inventory.adjusted' order by created_at desc limit 1`);
    expect(audit.actor_user_id).toBe(bm.id);
    expect(Number(audit.after_data.quantity) - Number(audit.before_data.quantity)).toBeCloseTo(4, 2);
    const events = await system((db) => db`select type from domain_events where aggregate_id = 'inv_jvc_hibiscus' order by created_at`);
    expect(events.map((e) => e.type)).toContain("inventory.adjusted");
  });

  it("removing more stock than exists is refused", async () => {
    const owner = await memberOf(ORG_A, "owner-inv", "OWNER");
    await expect(asUser(owner, (ctx) => recordMovement(ctx, { inventoryItemId: "inv_jvc_cilantro", type: "waste", quantity: 99999 }))).rejects.toMatchObject({ status: 409 });
  });

  it("crossing the threshold emits inventory.low", async () => {
    const owner = await memberOf(ORG_A, "owner-inv-2", "OWNER");
    const [item] = await system((db) => db`select quantity, threshold from inventory_items where id = 'inv_bbay_rice'`);
    const drop = Number(item.quantity) - Number(item.threshold) * 0.8;
    await asUser(owner, (ctx) => recordMovement(ctx, { inventoryItemId: "inv_bbay_rice", type: "waste", quantity: drop }));
    const events = await system((db) => db`select type from domain_events where aggregate_id = 'inv_bbay_rice' order by created_at`);
    expect(events.map((e) => e.type)).toContain("inventory.low");
  });
});

describe("menu, channels and settings mutations are evented and audited", () => {
  it("menu availability change", async () => {
    const ops = await memberOf(ORG_A, "ops-menu", "OPERATIONS_MANAGER");
    await asUser(ops, (ctx) => updateMenuItem(ctx, "itm_cn_drk_003", { isAvailable: false }));
    const [ev] = await system((db) => db`select type, actor_user_id from domain_events where aggregate_id = 'itm_cn_drk_003' order by created_at desc limit 1`);
    expect(ev).toMatchObject({ type: "menu.availability_changed", actor_user_id: ops.id });
    const [au] = await system((db) => db`select before_data, after_data from audit_logs where entity_id = 'itm_cn_drk_003' order by created_at desc limit 1`);
    expect(au.before_data.isAvailable).toBe(true);
    expect(au.after_data.isAvailable).toBe(false);
  });

  it("channel disconnect/connect", async () => {
    const ops = await memberOf(ORG_A, "ops-chan", "OPERATIONS_MANAGER");
    await asUser(ops, (ctx) => runConnectionAction(ctx, "noon", { action: "disconnect", locationId: "loc_bbay" }));
    await asUser(ops, (ctx) => runConnectionAction(ctx, "noon", { action: "connect", locationId: "loc_bbay" }));
    const types = (await system((db) => db`select type from domain_events where aggregate_id = 'conn_noon_bbay' order by created_at`)).map((r) => r.type);
    expect(types.slice(-2)).toEqual(["channel.disconnected", "channel.connected"]);
    const [conn] = await system((db) => db`select status from channel_connections where id = 'conn_noon_bbay'`);
    expect(conn.status).toBe("connected");
  });

  it("settings change records before/after", async () => {
    const owner = await memberOf(ORG_A, "owner-settings", "OWNER");
    await asUser(owner, (ctx) => updateSettings(ctx, { sla: { prepTargetMinutes: 20 } }));
    const [au] = await system((db) => db`select before_data, after_data from audit_logs where action = 'settings.updated' order by created_at desc limit 1`);
    expect(au.after_data.sla.prepTargetMinutes).toBe(20);
    expect(au.before_data.sla.prepTargetMinutes).not.toBe(20);
  });
});
