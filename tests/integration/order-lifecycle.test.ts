import { describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/server/db/client";
import { withUserTransaction } from "@/server/db/transaction";
import { buildAppContext, resolveIdentity, resolveScope } from "@/server/context/app-context";
import { loadChannelRuntime } from "@/server/demo/backend-session";
import { ingestPendingOrders } from "@/server/services/ingestion";
import { getKitchenBoard } from "@/server/services/kitchen";
import { performOrderAction } from "@/server/services/orders";
import { createRepositories } from "@/server/repositories";
import { asUser, freshDemoOrder, memberOf, system } from "../support/helpers";
import { ORG_A } from "../support/fixtures";

describe("order lifecycle persistence", () => {
  it("state transitions persist, sync the kitchen ticket, and survive a new connection pool", async () => {
    const manager = await memberOf(ORG_A, "ops", "OPERATIONS_MANAGER");
    const order = await freshDemoOrder("loc_marina");
    expect(order.status).toBe("new");

    await asUser(manager, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    await asUser(manager, (ctx) => performOrderAction(ctx, order.id, { action: "start_preparing" }));
    const board = await asUser(manager, (ctx) => getKitchenBoard(ctx));
    expect(board.tickets.find((t) => t.id === order.id)?.status).toBe("preparing");
    await asUser(manager, (ctx) => performOrderAction(ctx, order.id, { action: "mark_ready" }));
    await asUser(manager, (ctx) => performOrderAction(ctx, order.id, { action: "mark_picked_up" }));

    // "Restart": drop every pooled connection and read through a fresh pool.
    await closeSql();
    const sql = getSql();
    const [row] = await sql`select o.status, o.accepted_at, o.ready_at, o.picked_up_at, k.status as ticket from orders o join kitchen_tickets k on k.order_id = o.id where o.id = ${order.id}`;
    expect(row.status).toBe("picked_up");
    expect(row.accepted_at).toBeTruthy();
    expect(row.ready_at).toBeTruthy();
    expect(row.ticket).toBe("bumped");

    const events = (await sql`select type from domain_events where aggregate_id = ${order.id} order by created_at`).map((r) => r.type);
    expect(events).toEqual(["order.received", "order.accepted", "order.preparing", "order.ready", "order.picked_up"]);
  });

  it("invalid transitions are rejected with a conflict and change nothing", async () => {
    const manager = await memberOf(ORG_A, "ops-2", "OPERATIONS_MANAGER");
    const order = await freshDemoOrder("loc_jvc", "deliveroo");
    await expect(asUser(manager, (ctx) => performOrderAction(ctx, order.id, { action: "mark_picked_up" }))).rejects.toMatchObject({ status: 409 });
    const [row] = await system((db) => db`select status from orders where id = ${order.id}`);
    expect(row.status).toBe("new");
  });

  it("accepting consumes recipe inventory exactly once and records usage movements", async () => {
    const manager = await memberOf(ORG_A, "ops-3", "OPERATIONS_MANAGER");
    const order = await freshDemoOrder("loc_marina");
    await asUser(manager, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    const movements = await system((db) => db`select quantity, actor_user_id, reason from inventory_movements where order_id = ${order.id} and type = 'usage'`);
    expect(movements.length).toBeGreaterThan(0);
    expect(movements.every((m) => Number(m.quantity) <= 0 && m.actor_user_id === manager.id && m.reason === "order_accepted")).toBe(true);
    // idempotent: applying usage again is a no-op
    const again = await asUser(manager, (ctx) => ctx.repos.inventory.applyOrderUsage(order.id, "user"));
    expect(again).toEqual([]);
  });
});

describe("idempotency", () => {
  it("the same external order delivered twice creates one CornerOps order", async () => {
    const before = await system(async (db) => (await db`select count(*)::int n from orders where organization_id = ${ORG_A}`)[0].n);
    const created = await system(async (db) => {
      const repos = createRepositories(db, ORG_A);
      const [connections, mappings, menuItems, customers, settings, restaurant] = await Promise.all([
        repos.channels.connections(), repos.menu.mappings(), repos.menu.items(), repos.customers.list(), repos.organization.settings(), repos.organization.restaurant(),
      ]);
      const payload = {
        order_id: "TLB-IDEMPOTENCY-1", short_code: "9999", vendor_code: "TLB-CN-MARINA", created_at: new Date().toISOString(),
        expedition_type: "TALABAT_DELIVERY", customer: { first_name: "Retry", phone_masked: "+971 50 ••• 0000" },
        items: [{ sku: mappings.find((m) => m.channel === "talabat" && m.externalItemId)!.externalItemId!, title: "Item", qty: 1, unit_price: 50, options: [] }],
        payment: { method: "ONLINE", wallet_used: false },
        price: { subtotal: 50, discount_total: 0, delivery_fee: 7, vat: 2.5, grand_total: 59.5 }, status: "RECEIVED",
      };
      const runtime = await loadChannelRuntime(repos, { inboxes: { talabat: [payload, structuredClone(payload)] } });
      const ic = { organizationId: ORG_A, restaurantId: restaurant.id, connections, mappings, menuItems, customers, economics: settings.economics };
      const first = await ingestPendingOrders(db, repos, runtime, ic, { kind: "system", label: "test" }, Date.now());
      runtime.backend.pushInbox("talabat", structuredClone(payload)); // webhook retried later
      const second = await ingestPendingOrders(db, repos, runtime, ic, { kind: "system", label: "test" }, Date.now());
      return { first: first.length, second: second.length };
    });
    expect(created).toEqual({ first: 1, second: 0 });
    const after = await system(async (db) => (await db`select count(*)::int n from orders where organization_id = ${ORG_A}`)[0].n);
    expect(after).toBe(before + 1);
  });

  it("the database constraint rejects a duplicate (organization, channel, external id)", async () => {
    await expect(
      system((db) => db`
        insert into orders (id, organization_id, restaurant_id, location_id, order_number, external_order_id, channel_id, status, fulfillment,
          subtotal, total, payment_method, estimated_prep_minutes, placed_at, source)
        select 'ord_dup_test', organization_id, restaurant_id, location_id, 'CO-DUP-1', external_order_id, channel_id, 'new', 'delivery',
          10, 10, 'card_online', 10, now(), 'mock'
        from orders where external_order_id = 'TLB-IDEMPOTENCY-1'`),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("event and audit atomicity", () => {
  it("a failed request rolls back the status change, event and audit entry together", async () => {
    const manager = await memberOf(ORG_A, "ops-4", "OPERATIONS_MANAGER");
    const order = await freshDemoOrder("loc_marina");
    const identity = await withUserTransaction(manager.id, (db) => resolveIdentity(db, manager, { includeDemo: true }));
    await expect(
      withUserTransaction(manager.id, async (db) => {
        const ctx = buildAppContext(db, identity, resolveScope(identity.allowedLocations, null));
        await performOrderAction(ctx, order.id, { action: "accept" });
        throw new Error("boom after commit point");
      }),
    ).rejects.toThrow("boom");
    const [state] = await system((db) => db`
      select (select status from orders where id = ${order.id}) as status,
             (select count(*)::int from domain_events where aggregate_id = ${order.id} and type = 'order.accepted') as events,
             (select count(*)::int from audit_logs where entity_id = ${order.id}) as audits,
             (select count(*)::int from inventory_movements where order_id = ${order.id}) as movements`);
    expect(state).toMatchObject({ status: "new", events: 0, audits: 0, movements: 0 });
  });

  it("audit logs capture actor and before/after, and are append-only", async () => {
    const owner = await memberOf(ORG_A, "owner-audit", "OWNER");
    const order = await freshDemoOrder("loc_marina");
    await asUser(owner, (ctx) => performOrderAction(ctx, order.id, { action: "cancel", reason: "Kitchen too busy" }));
    const [log] = await system((db) => db`select * from audit_logs where entity_id = ${order.id}`);
    expect(log.action).toBe("order.cancelled");
    expect(log.actor_user_id).toBe(owner.id);
    expect(log.before_data.status).toBe("new");
    expect(log.after_data.status).toBe("cancelled");
    expect(log.after_data.cancellationReason).toBe("Kitchen too busy");
    expect(log.location_id).toBe("loc_marina");
    await expect(system((db) => db`update audit_logs set action = 'tampered' where id = ${log.id}`)).rejects.toMatchObject({ status: 403 });
    await expect(system((db) => db`delete from audit_logs where id = ${log.id}`)).rejects.toMatchObject({ status: 403 });
  });
});
