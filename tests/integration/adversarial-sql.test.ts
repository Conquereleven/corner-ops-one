/**
 * Adversarial tests at the database boundary: realistic roles issue SQL
 * directly (as a compromised client or a buggy service could), bypassing the
 * application layer. Each test encodes the required secure behavior.
 */
import { describe, expect, it } from "vitest";
import { getAnalytics } from "@/server/services/analytics";
import { getInventory } from "@/server/services/inventory";
import { getMenu } from "@/server/services/menu";
import { getSettings } from "@/server/services/settings";
import { asUser, freshDemoOrder, memberOf, rawAs, system } from "../support/helpers";
import { ORG_A, ORG_B } from "../support/fixtures";

const MARINA = "loc_marina";

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

describe("orders: state changes only through the authorized transition operation", () => {
  it("kitchen staff cannot cancel an order with a direct UPDATE", async () => {
    const cook = await memberOf(ORG_A, "adv-cook", "KITCHEN_STAFF", [MARINA]);
    const order = await freshDemoOrder(MARINA);
    await attempt(() => rawAs(cook, (db) => db`update orders set status = 'cancelled', cancelled_at = now() where id = ${order.id}`));
    const [row] = await system((db) => db`select status from orders where id = ${order.id}`);
    expect(row.status).toBe("new");
  });

  it("kitchen staff cannot cancel through the transition operation either", async () => {
    const cook = await memberOf(ORG_A, "adv-cook-2", "KITCHEN_STAFF", [MARINA]);
    const order = await freshDemoOrder(MARINA);
    const res = await attempt(() => rawAs(cook, (db) => db`select public.apply_order_transition(${order.id}, 'cancel', 'nope', 'synced', null, null)`));
    expect(res.ok).toBe(false);
    const [row] = await system((db) => db`select status from orders where id = ${order.id}`);
    expect(row.status).toBe("new");
  });

  it("no member can rewrite financial fields of an order", async () => {
    const owner = await memberOf(ORG_A, "adv-owner-fin", "OWNER");
    const order = await freshDemoOrder(MARINA);
    await attempt(() => rawAs(owner, (db) => db`update orders set total = 0, subtotal = 0, platform_fee = 0, discount = 999 where id = ${order.id}`));
    const [row] = await system((db) => db`select total, subtotal from orders where id = ${order.id}`);
    expect(Number(row.total)).toBe(order.total);
    expect(Number(row.subtotal)).toBe(order.subtotal);
  });

  it("a direct status UPDATE cannot skip inventory, events and audit", async () => {
    const ops = await memberOf(ORG_A, "adv-ops", "OPERATIONS_MANAGER");
    const order = await freshDemoOrder(MARINA);
    await attempt(() => rawAs(ops, (db) => db`update orders set status = 'accepted', accepted_at = now() where id = ${order.id}`));
    const [row] = await system((db) => db`
      select o.status,
        (select count(*)::int from inventory_movements m where m.order_id = o.id) as movements,
        (select count(*)::int from domain_events e where e.aggregate_id = o.id and e.type = 'order.accepted') as events,
        (select count(*)::int from audit_logs a where a.entity_id = o.id) as audits
      from orders o where o.id = ${order.id}`);
    // Either the update is refused (status stays new) or everything was recorded.
    if (row.status === "accepted") expect(row.movements > 0 && row.events === 1 && row.audits === 1).toBe(true);
    else expect(row.status).toBe("new");
  });

  it("members cannot fabricate orders or order items", async () => {
    const owner = await memberOf(ORG_A, "adv-owner-fab", "OWNER");
    const res = await attempt(() =>
      rawAs(owner, (db) => db`
        insert into orders (id, organization_id, restaurant_id, location_id, order_number, external_order_id, channel_id, status, fulfillment,
          subtotal, total, payment_method, estimated_prep_minutes, placed_at, source)
        values ('ord_fabricated', ${ORG_A}, 'rst_casa_norte', ${MARINA}, 'CO-FAKE', 'FAKE-1', 'talabat', 'completed', 'delivery', 9999, 9999, 'card_online', 10, now(), 'live')`),
    );
    expect(res.ok).toBe(false);
  });

  it("members cannot forge audit entries", async () => {
    const owner = await memberOf(ORG_A, "adv-owner-audit", "OWNER");
    const res = await attempt(() =>
      rawAs(owner, (db) => db`insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id) values (${ORG_A}, ${owner.id}, 'order.status_changed', 'order', 'x')`),
    );
    expect(res.ok).toBe(false);
  });
});

describe("financial and cost information", () => {
  it.each([
    ["menu food cost", "select food_cost from menu_items limit 1"],
    ["inventory unit cost", "select unit_cost from inventory_items limit 1"],
    ["commercial terms", "select economics from organization_settings limit 1"],
    ["platform commission", "select platform_fee from orders limit 1"],
    ["daily platform fees", "select platform_fees from daily_metrics limit 1"],
  ])("kitchen staff cannot read %s", async (_label, query) => {
    const cook = await memberOf(ORG_A, `adv-cook-fin-${_label.replace(/\W/g, "")}`, "KITCHEN_STAFF", [MARINA]);
    const res = await attempt(() => rawAs(cook, (db) => db.unsafe(query)));
    expect(res.ok).toBe(false);
  });

  it("branch managers cannot read costs through the financial functions", async () => {
    const bm = await memberOf(ORG_A, "adv-bm-fin", "BRANCH_MANAGER", [MARINA]);
    const res = await attempt(() => rawAs(bm, (db) => db`select * from public.financial_menu_costs(${ORG_A})`));
    expect(res.ok).toBe(false);
  });

  it("platform commission is readable only through the finance function, for finance roles", async () => {
    const order = await freshDemoOrder(MARINA);
    const bm = await memberOf(ORG_A, "adv-bm-fee", "BRANCH_MANAGER", [MARINA]);
    const ops = await memberOf(ORG_A, "adv-ops-fee", "OPERATIONS_MANAGER");
    await expect(rawAs(bm, (db) => db`select * from public.financial_order_fees(${ORG_A}, ${[order.id]})`)).rejects.toMatchObject({ status: 403 });
    await expect(rawAs(ops, (db) => db`select platform_fee from orders where id = ${order.id}`)).rejects.toMatchObject({ status: 403 });
    const rows = await rawAs(ops, (db) => db`select * from public.financial_order_fees(${ORG_A}, ${[order.id]})`);
    expect(rows.length).toBe(1);
  });

  it("channel credential references are not readable by any client role", async () => {
    const owner = await memberOf(ORG_A, "adv-owner-cred", "OWNER");
    await expect(rawAs(owner, (db) => db`select credential_reference from channel_connections limit 1`)).rejects.toMatchObject({ status: 403 });
  });

  it("finance roles of one organization cannot read another organization's costs", async () => {
    const ownerA = await memberOf(ORG_A, "adv-owner-a-costs", "OWNER");
    await expect(rawAs(ownerA, (db) => db`select * from public.financial_menu_costs(${ORG_B})`)).rejects.toMatchObject({ status: 403 });
    await expect(rawAs(ownerA, (db) => db`select public.financial_economics(${ORG_B})`)).rejects.toMatchObject({ status: 403 });
  });

  it("the application returns no cost data to branch managers, and full data to operations managers", async () => {
    const bm = await memberOf(ORG_A, "adv-bm-app-fin", "BRANCH_MANAGER", [MARINA]);
    const ops = await memberOf(ORG_A, "adv-ops-app-fin", "OPERATIONS_MANAGER");
    const view = (u: typeof bm) =>
      asUser(u, async (ctx) => ({
        menu: await getMenu(ctx),
        inventory: await getInventory(ctx),
        settings: await getSettings(ctx),
        analytics: await getAnalytics(ctx, "7d"),
        orders: await ctx.data.orders({ from: Date.now() - 86_400_000, to: Date.now() + 1 }),
      }));
    const b = await view(bm);
    expect(b.menu.items.every((i) => i.foodCost === undefined && i.foodCostPct === undefined)).toBe(true);
    expect(b.inventory.items.every((i) => i.unitCost === undefined)).toBe(true);
    expect(b.inventory.stockValue).toBeNull();
    expect(b.settings.settings.economics).toBeNull();
    expect(b.analytics.profitability).toBeNull();
    expect(b.analytics.topProducts.every((p) => p.marginPct === undefined)).toBe(true);
    expect(b.orders.every((o) => o.platformFee === undefined)).toBe(true);

    const o = await view(ops);
    expect(o.menu.items.every((i) => typeof i.foodCost === "number")).toBe(true);
    expect(o.inventory.stockValue).toBeGreaterThan(0);
    expect(o.settings.settings.economics).not.toBeNull();
    expect(o.analytics.profitability).not.toBeNull();
    expect(o.orders.some((x) => x.platformFee !== undefined)).toBe(true);
  });

  it("owners read costs through the financial functions", async () => {
    const owner = await memberOf(ORG_A, "adv-owner-costs", "OWNER");
    const rows = await rawAs(owner, (db) => db`select * from public.financial_menu_costs(${ORG_A})`);
    expect(rows.length).toBeGreaterThan(20);
  });
});

describe("audit cannot be suppressed or bypassed by clients", () => {
  it("setting the audit-suspension or guard flags from a client session has no effect", async () => {
    const owner = await memberOf(ORG_B, "adv-owner-b-suspend", "OWNER");
    const before = await system(async (db) => (await db`select count(*)::int n from audit_logs where organization_id = ${ORG_B} and action = 'settings.updated'`)[0].n);
    await rawAs(owner, async (db) => {
      await db`select set_config('cornerops.audit_suspended', 'on', true)`;
      await db`update organization_settings set sla = sla || '{"warningRatio": 0.7}'::jsonb where organization_id = ${ORG_B}`;
    });
    const after = await system(async (db) => (await db`select count(*)::int n from audit_logs where organization_id = ${ORG_B} and action = 'settings.updated'`)[0].n);
    expect(after).toBe(before + 1);
  });

  it("anon has no table or function access", async () => {
    const res = await attempt(() => system(async (db) => {
      await db`set local role anon`;
      return db`select public.demo_feed(${ORG_A}, 5)`;
    }));
    expect(res.ok).toBe(false);
  });
});

describe("inventory: direct stock edits are not allowed", () => {
  it("a branch manager cannot change stock without a movement record", async () => {
    const bm = await memberOf(ORG_A, "adv-bm-stock", "BRANCH_MANAGER", [MARINA]);
    const [before] = await system((db) => db`select quantity from inventory_items where id = 'inv_marina_rice'`);
    await attempt(() => rawAs(bm, (db) => db`update inventory_items set quantity = 9999 where id = 'inv_marina_rice'`));
    const [after] = await system((db) => db`select quantity from inventory_items where id = 'inv_marina_rice'`);
    expect(Number(after.quantity)).toBe(Number(before.quantity));
  });
});

describe("tenant relationship integrity", () => {
  it("a membership cannot be granted a location of another organization", async () => {
    await memberOf(ORG_B, "adv-b-bm", "BRANCH_MANAGER", ["cnh_loc_marina"]);
    const [m] = await system((db) => db`select id from organization_memberships where organization_id = ${ORG_B} and role = 'BRANCH_MANAGER' limit 1`);
    expect(m?.id).toBeTruthy();
    const viaBOrg = await attempt(() => system((db) => db`insert into membership_locations (membership_id, location_id, organization_id) values (${m.id}, ${MARINA}, ${ORG_B})`));
    const viaAOrg = await attempt(() => system((db) => db`insert into membership_locations (membership_id, location_id, organization_id) values (${m.id}, ${MARINA}, ${ORG_A})`));
    expect(viaBOrg.ok).toBe(false);
    expect(viaAOrg.ok).toBe(false);
  });

  it("an order cannot point at another organization's location or restaurant", async () => {
    const res = await attempt(() =>
      system((db) => db`
        insert into orders (id, organization_id, restaurant_id, location_id, order_number, external_order_id, channel_id, status, fulfillment,
          subtotal, total, payment_method, estimated_prep_minutes, placed_at, source)
        values ('ord_cross_tenant', ${ORG_B}, 'rst_casa_norte', ${MARINA}, 'CO-X-1', 'X-1', 'talabat', 'new', 'delivery', 10, 10, 'card_online', 10, now(), 'mock')`),
    );
    expect(res.ok).toBe(false);
  });

  it("an order item cannot belong to a different location than its order", async () => {
    const order = await freshDemoOrder(MARINA);
    const res = await attempt(() =>
      system((db) => db`
        insert into order_items (id, organization_id, order_id, location_id, name, quantity, unit_price, total)
        values ('oi_mismatch', ${ORG_A}, ${order.id}, 'loc_jvc', 'x', 1, 1, 1)`),
    );
    expect(res.ok).toBe(false);
  });

  it("an inventory movement cannot reference another organization's item", async () => {
    const res = await attempt(() =>
      system((db) => db`
        insert into inventory_movements (id, organization_id, location_id, inventory_item_id, type, quantity, actor_label)
        values ('mov_cross', ${ORG_B}, 'cnh_loc_marina', 'inv_marina_rice', 'adjustment', 1, 'test')`),
    );
    expect(res.ok).toBe(false);
  });
});

describe("demo workspace isolation at the database", () => {
  async function demoUser() {
    const [u] = await system((db) => db`select user_id from public.organization_memberships where organization_id = ${ORG_A} and role = 'ADMIN' order by created_at limit 1`);
    const [p] = await system((db) => db`select email from auth.users where id = ${u.user_id}`);
    return { id: String(u.user_id), email: String(p.email), name: "Demo" };
  }

  it("the shared demo identity cannot create a production organization", async () => {
    const demo = await demoUser();
    const res = await attempt(() => rawAs(demo, (db) => db`select public.create_organization('Escape Co', ${"escape-" + Date.now()}, 'Asia/Dubai', 'AED', ${db.json({ sla: {}, economics: {}, demo: { enabled: false } })})`));
    expect(res.ok).toBe(false);
  });

  it("the shared demo identity cannot acquire a production membership via invitation", async () => {
    const demo = await demoUser();
    const owner = await memberOf(ORG_B, "adv-owner-b-invite", "OWNER");
    await attempt(() => rawAs(owner, (db) => db`insert into organization_memberships (organization_id, invited_email, role, status, invited_by) values (${ORG_B}, ${demo.email}, 'ADMIN', 'invited', ${owner.id})`));
    await attempt(() => rawAs(demo, (db) => db`select public.claim_pending_invitations()`));
    const [r] = await system((db) => db`select count(*)::int n from organization_memberships where organization_id = ${ORG_B} and user_id = ${demo.id}`);
    expect(r.n).toBe(0);
  });

  it("is_demo cannot be changed by organization admins", async () => {
    const owner = await memberOf(ORG_B, "adv-owner-b-flag", "OWNER");
    await attempt(() => rawAs(owner, (db) => db`update organizations set is_demo = true where id = ${ORG_B}`));
    const demo = await demoUser();
    await attempt(() => rawAs(demo, (db) => db`update organizations set is_demo = false where id = ${ORG_A}`));
    const rows = await system((db) => db`select id, is_demo from organizations where id in (${ORG_A}, ${ORG_B}) order by id`);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.is_demo]))).toEqual({ [ORG_B]: false, [ORG_A]: true });
  });

  it("even a trusted server connection cannot give the demo identity a production membership", async () => {
    const demo = await demoUser();
    const res = await attempt(() => system((db) => db`insert into organization_memberships (organization_id, user_id, role, status) values (${ORG_B}, ${demo.id}, 'ADMIN', 'active')`));
    expect(res.ok).toBe(false);
  });

  it("demo admins cannot change roles or remove members of the demo organization with SQL", async () => {
    const demo = await demoUser();
    const target = await memberOf(ORG_A, "adv-demo-target", "KITCHEN_STAFF", [MARINA]);
    await attempt(() => rawAs(demo, (db) => db`update organization_memberships set role = 'ADMIN' where organization_id = ${ORG_A} and user_id = ${target.id}`));
    await attempt(() => rawAs(demo, (db) => db`delete from organization_memberships where organization_id = ${ORG_A} and user_id = ${target.id}`));
    const [m] = await system((db) => db`select role from organization_memberships where organization_id = ${ORG_A} and user_id = ${target.id}`);
    expect(m.role).toBe("KITCHEN_STAFF");
  });

  it("demo admins cannot add members to the demo organization with SQL", async () => {
    const demo = await demoUser();
    const res = await attempt(() => rawAs(demo, (db) => db`insert into organization_memberships (organization_id, invited_email, role, status) values (${ORG_A}, 'someone@customer.com', 'ADMIN', 'invited')`));
    expect(res.ok).toBe(false);
  });
});

describe("domain events are immutable", () => {
  it("no column except processing state can change, and events cannot be deleted", async () => {
    const [ev] = await system((db) => db`select id from domain_events where organization_id = ${ORG_A} limit 1`);
    const upd = await attempt(() => system((db) => db`update domain_events set actor_label = 'tampered', location_id = null, aggregate_type = 'x' where id = ${ev.id}`));
    const del = await attempt(() => system((db) => db`delete from domain_events where id = ${ev.id}`));
    expect(upd.ok).toBe(false);
    expect(del.ok).toBe(false);
    const ok = await attempt(() => system((db) => db`update domain_events set processed_at = now(), attempts = attempts + 1 where id = ${ev.id}`));
    expect(ok.ok).toBe(true);
  });
});
