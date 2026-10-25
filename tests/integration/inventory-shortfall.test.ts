/**
 * Founder-approved shortage policy (v0.2.1):
 *  1 deduct only what is available            6 no automatic READY/fulfilment with an open shortfall
 *  2 never create negative stock               7 authorized, audited manual resolution
 *  3 persist requested / consumed / unmet      8 idempotent and concurrency safe
 *  4 emit inventory.shortfall in the same tx   9 restocking never deducts automatically
 *  5 surface a high-priority alert
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { UnifiedOrder } from "@/domain/orders/types";
import { listAlerts } from "@/server/services/alerts";
import { recordMovement } from "@/server/services/inventory";
import { performOrderAction, resolveOrderShortfall } from "@/server/services/orders";
import { asUser, freshDemoOrder, memberOf, rawAs, system } from "../support/helpers";
import { ORG_A } from "../support/fixtures";

const MARINA = "loc_marina";

// These tests drain Dubai Marina stock on purpose; put it back after each one.
let snapshot: { id: string; quantity: number }[] = [];
beforeAll(async () => {
  snapshot = (await system((db) => db`select id, quantity from inventory_items where location_id = ${MARINA}`)).map((r) => ({ id: String(r.id), quantity: Number(r.quantity) }));
});
afterEach(async () => {
  await system(async (db) => {
    await db`select set_config('cornerops.bypass_inventory_guard', 'on', true)`;
    for (const s of snapshot) await db`update inventory_items set quantity = ${s.quantity} where id = ${s.id}`;
  });
});

type Demand = { key: string; demand: number; itemId: string };

async function demandOf(orderId: string): Promise<Demand[]> {
  const rows = await system((db) => db`
    select r.ingredient_key as key, sum(r.quantity * oi.quantity)::float8 as demand, ii.id as item_id
    from order_items oi
    join menu_item_recipes r on r.menu_item_id = oi.menu_item_id
    join orders o on o.id = oi.order_id
    join inventory_items ii on ii.location_id = o.location_id and ii.ingredient_key = r.ingredient_key
    where oi.order_id = ${orderId}
    group by r.ingredient_key, ii.id order by r.ingredient_key`);
  return rows.map((r) => ({ key: String(r.key), demand: Number(r.demand), itemId: String(r.item_id) }));
}

/** Test setup only: set stock directly (the guard is bypassed explicitly, on a system connection). */
async function setStock(itemId: string, quantity: number) {
  await system(async (db) => {
    await db`select set_config('cornerops.bypass_inventory_guard', 'on', true)`;
    await db`update inventory_items set quantity = ${quantity} where id = ${itemId}`;
  });
}

const stock = async (itemId: string) => Number((await system((db) => db`select quantity from inventory_items where id = ${itemId}`))[0].quantity);
const shortfalls = (orderId: string) => system((db) => db`select * from order_inventory_shortfalls where order_id = ${orderId} order by ingredient_key`);
const usage = (orderId: string) => system((db) => db`select * from inventory_movements where order_id = ${orderId} and type = 'usage' order by inventory_item_id`);
const count = async (q: Promise<{ n: number }[]>) => Number((await q)[0].n);

/** An order at Dubai Marina with one ingredient restricted to `available` (fraction of its demand). */
async function orderShortOn(fraction: number) {
  const order = await freshDemoOrder(MARINA);
  const [target] = await demandOf(order.id);
  expect(target, "fresh order should use at least one stocked ingredient").toBeTruthy();
  const available = Math.round(target.demand * fraction * 1000) / 1000;
  await setStock(target.itemId, available);
  return { order, target, available };
}

describe("shortage on acceptance", () => {
  it("partial stock: deducts only what is available and records requested / consumed / unmet", async () => {
    const cook = await memberOf(ORG_A, "sf-cook-partial", "KITCHEN_STAFF", [MARINA]);
    const { order, target, available } = await orderShortOn(0.5);
    await asUser(cook, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));

    expect(await stock(target.itemId)).toBe(0);
    const mv = (await usage(order.id)).find((m) => m.inventory_item_id === target.itemId)!;
    expect(Number(mv.quantity)).toBeCloseTo(-available, 3);
    expect(Number(mv.requested_quantity)).toBeCloseTo(target.demand, 3);
    expect(Number(mv.shortfall_quantity)).toBeCloseTo(target.demand - available, 3);

    const [line] = (await shortfalls(order.id)).filter((s) => s.ingredient_key === target.key);
    expect(line).toMatchObject({ status: "open", inventory_item_id: target.itemId });
    expect(Number(line.requested_quantity)).toBeCloseTo(target.demand, 3);
    expect(Number(line.consumed_quantity)).toBeCloseTo(available, 3);
    expect(Number(line.unmet_quantity)).toBeCloseTo(target.demand - available, 3);

    // Event and audit written by the same transaction as the acceptance.
    expect(await count(system((db) => db`select count(*)::int n from domain_events where aggregate_id = ${order.id} and type = 'inventory.shortfall'`))).toBe(1);
    expect(await count(system((db) => db`select count(*)::int n from audit_logs where entity_id = ${order.id} and action = 'inventory.shortfall'`))).toBe(1);
    const [acc] = await system((db) => db`select status from orders where id = ${order.id}`);
    expect(acc.status).toBe("accepted");
  });

  it("zero stock: nothing is deducted, the whole demand is unmet, and stock never goes negative", async () => {
    const bm = await memberOf(ORG_A, "sf-bm-zero", "BRANCH_MANAGER", [MARINA]);
    const order = await freshDemoOrder(MARINA);
    const demand = await demandOf(order.id);
    for (const d of demand) await setStock(d.itemId, 0);
    await asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));

    for (const d of demand) expect(await stock(d.itemId)).toBe(0);
    for (const m of await usage(order.id)) {
      expect(Number(m.quantity)).toBe(0);
      expect(Number(m.shortfall_quantity)).toBeCloseTo(Number(m.requested_quantity), 3);
    }
    const lines = await shortfalls(order.id);
    expect(lines.length).toBe(demand.length);
    expect(lines.every((l) => l.status === "open" && Number(l.consumed_quantity) === 0)).toBe(true);
    expect(await count(system((db) => db`select count(*)::int n from inventory_items where quantity < 0`))).toBe(0);
  });

  it("surfaces a critical operational alert for the order", async () => {
    const ops = await memberOf(ORG_A, "sf-ops-alert", "OPERATIONS_MANAGER");
    const { order } = await orderShortOn(0);
    await asUser(ops, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    const alerts = await asUser(ops, (ctx) => listAlerts(ctx));
    expect(alerts.find((a) => a.id === `shortfall:${order.id}`)).toMatchObject({ severity: "critical", category: "inventory", locationId: MARINA });
  });
});

describe("fulfilment is blocked while a shortfall is open", () => {
  it("cannot be marked ready (service or SQL), but can still be prepared or cancelled", async () => {
    const cook = await memberOf(ORG_A, "sf-cook-block", "KITCHEN_STAFF", [MARINA]);
    const owner = await memberOf(ORG_A, "sf-owner-block", "OWNER");
    const { order } = await orderShortOn(0.25);
    await asUser(cook, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    await asUser(cook, (ctx) => performOrderAction(ctx, order.id, { action: "start_preparing" }));

    await expect(asUser(cook, (ctx) => performOrderAction(ctx, order.id, { action: "mark_ready" }))).rejects.toMatchObject({ status: 409 });
    await expect(rawAs(owner, (db) => db`select public.apply_order_transition(${order.id}, 'mark_ready')`)).rejects.toMatchObject({ status: 409 });
    const [row] = await system((db) => db`select status from orders where id = ${order.id}`);
    expect(row.status).toBe("preparing");

    await asUser(owner, (ctx) => performOrderAction(ctx, order.id, { action: "cancel", reason: "Item unavailable" }));
    const [after] = await system((db) => db`select status from orders where id = ${order.id}`);
    expect(after.status).toBe("cancelled");
  });
});

describe("idempotency and concurrency", () => {
  it("retries never deduct twice or duplicate shortfall lines", async () => {
    const bm = await memberOf(ORG_A, "sf-bm-retry", "BRANCH_MANAGER", [MARINA]);
    const { order, target } = await orderShortOn(0.5);
    await asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    const before = { stock: await stock(target.itemId), usage: (await usage(order.id)).length, lines: (await shortfalls(order.id)).length };

    await expect(asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }))).rejects.toMatchObject({ status: 409 });
    await rawAs(bm, (db) => db`select * from public.apply_order_inventory_usage(${order.id})`);
    await system((db) => db`select * from public.apply_order_inventory_usage(${order.id}, 'retry')`);

    expect(await stock(target.itemId)).toBe(before.stock);
    expect((await usage(order.id)).length).toBe(before.usage);
    expect((await shortfalls(order.id)).length).toBe(before.lines);
    expect(await count(system((db) => db`select count(*)::int n from domain_events where aggregate_id = ${order.id} and type = 'inventory.shortfall'`))).toBe(1);
  });

  it("concurrent acceptances of the same order consume stock exactly once", async () => {
    const bm = await memberOf(ORG_A, "sf-bm-race", "BRANCH_MANAGER", [MARINA]);
    const { order, target, available } = await orderShortOn(0.5);
    const results = await Promise.allSettled([1, 2, 3].map(() => asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }))));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await stock(target.itemId)).toBe(0);
    const mv = (await usage(order.id)).filter((m) => m.inventory_item_id === target.itemId);
    expect(mv.length).toBe(1);
    expect(Number(mv[0].quantity)).toBeCloseTo(-available, 3);
  });

  it("a concurrent manual movement and an acceptance never oversell or go negative", async () => {
    const bm = await memberOf(ORG_A, "sf-bm-race-2", "BRANCH_MANAGER", [MARINA]);
    const { order, target, available } = await orderShortOn(0.6);
    const [accept, waste] = await Promise.allSettled([
      asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "accept" })),
      asUser(bm, (ctx) => recordMovement(ctx, { inventoryItemId: target.itemId, type: "waste", quantity: available, note: "dropped tray" })),
    ]);
    expect(accept.status).toBe("fulfilled");
    const final = await stock(target.itemId);
    expect(final).toBeGreaterThanOrEqual(0);
    const consumed = -Number((await usage(order.id)).find((m) => m.inventory_item_id === target.itemId)!.quantity);
    const wasted = waste.status === "fulfilled" ? available : 0;
    expect(available - final).toBeCloseTo(consumed + wasted, 3);
  });

  it("two orders competing for the same scarce ingredient never oversell it", async () => {
    const bm = await memberOf(ORG_A, "sf-bm-compete", "BRANCH_MANAGER", [MARINA]);
    // Find two fresh orders that share an ingredient.
    const orders: { order: UnifiedOrder }[] = [];
    for (let i = 0; i < 8 && orders.length < 2; i++) orders.push({ order: await freshDemoOrder(MARINA) });
    const demands = await Promise.all(orders.map((o) => demandOf(o.order.id)));
    const shared = demands[0].find((d) => demands[1].some((e) => e.key === d.key));
    expect(shared, "two demo orders should share an ingredient").toBeTruthy();
    const total = shared!.demand + demands[1].find((e) => e.key === shared!.key)!.demand;
    const initial = Math.round(total * 0.6 * 1000) / 1000;
    await setStock(shared!.itemId, initial);

    await Promise.all(orders.map((o) => asUser(bm, (ctx) => performOrderAction(ctx, o.order.id, { action: "accept" }))));
    const final = await stock(shared!.itemId);
    const consumed = (await system((db) => db`
      select coalesce(sum(-quantity), 0)::float8 as c from inventory_movements
      where inventory_item_id = ${shared!.itemId} and type = 'usage' and order_id = any(${orders.map((o) => o.order.id)})`))[0].c;
    expect(final).toBeGreaterThanOrEqual(0);
    expect(Number(consumed)).toBeCloseTo(initial - final, 3);
    expect(Number(consumed)).toBeLessThanOrEqual(initial + 1e-6);
  });
});

describe("restock and resolution", () => {
  it("restocking does not deduct automatically; reconciliation is an explicit, audited operation", async () => {
    const bm = await memberOf(ORG_A, "sf-bm-reconcile", "BRANCH_MANAGER", [MARINA]);
    const { order, target, available } = await orderShortOn(0.5);
    await asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    const unmet = target.demand - available;

    await asUser(bm, (ctx) => recordMovement(ctx, { inventoryItemId: target.itemId, type: "purchase", quantity: unmet * 3, note: "supplier delivery" }));
    expect(await stock(target.itemId)).toBeCloseTo(unmet * 3, 3);
    expect((await shortfalls(order.id)).find((l) => l.ingredient_key === target.key)!.status).toBe("open");

    // Resolve every open line: reconcile what stock allows, accept the rest with a note.
    await asUser(bm, (ctx) => resolveOrderShortfall(ctx, order.id, { method: "reconcile_from_stock" }));
    expect(await stock(target.itemId)).toBeCloseTo(unmet * 2, 3);
    const line = (await shortfalls(order.id)).find((l) => l.ingredient_key === target.key)!;
    expect(line).toMatchObject({ status: "resolved", resolution: "reconciled_from_stock", resolved_by: bm.id });
    expect(Number(line.unmet_quantity)).toBe(0);
    expect(Number(line.consumed_quantity)).toBeCloseTo(target.demand, 3);

    const [rec] = await system((db) => db`
      select quantity, reason, actor_user_id from inventory_movements where order_id = ${order.id} and reason = 'shortfall_reconciliation'`);
    expect(Number(rec.quantity)).toBeCloseTo(-unmet, 3);
    expect(rec.actor_user_id).toBe(bm.id);
    const [audit] = await system((db) => db`
      select actor_user_id, before_data, after_data, metadata from audit_logs where entity_id = ${order.id} and action = 'inventory.shortfall_resolved'`);
    expect(audit.actor_user_id).toBe(bm.id);
    expect(audit.metadata.method).toBe("reconcile_from_stock");
    expect(audit.before_data.lines.length).toBeGreaterThan(0);
    expect(await count(system((db) => db`select count(*)::int n from domain_events where aggregate_id = ${order.id} and type = 'inventory.shortfall_resolved'`))).toBe(1);

    // Resolution is idempotent and, once nothing is open, fulfilment continues.
    const again = await asUser(bm, (ctx) => resolveOrderShortfall(ctx, order.id, { method: "reconcile_from_stock" }));
    expect(again.resolved).toBe(0);
    await asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "mark_ready" }));
    const [row] = await system((db) => db`select status from orders where id = ${order.id}`);
    expect(row.status).toBe("ready");
  });

  it("partial reconciliation leaves the remainder open; accepting it requires a note", async () => {
    const bm = await memberOf(ORG_A, "sf-bm-partial-res", "BRANCH_MANAGER", [MARINA]);
    const { order, target } = await orderShortOn(0);
    await asUser(bm, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));
    const half = Math.round((target.demand / 2) * 1000) / 1000;
    await asUser(bm, (ctx) => recordMovement(ctx, { inventoryItemId: target.itemId, type: "purchase", quantity: half }));

    const res = await asUser(bm, (ctx) => resolveOrderShortfall(ctx, order.id, { method: "reconcile_from_stock" }));
    expect(res.open).toBeGreaterThan(0);
    expect(await stock(target.itemId)).toBe(0);
    const line = (await shortfalls(order.id)).find((l) => l.ingredient_key === target.key)!;
    expect(line.status).toBe("open");
    expect(Number(line.unmet_quantity)).toBeCloseTo(target.demand - half, 3);

    await expect(asUser(bm, (ctx) => resolveOrderShortfall(ctx, order.id, { method: "accept_shortfall" }))).rejects.toMatchObject({ status: 409 });
    await expect(rawAs(bm, (db) => db`select public.resolve_order_shortfall(${order.id}, 'accept_shortfall', null)`)).rejects.toMatchObject({ status: 409 });

    await asUser(bm, (ctx) => resolveOrderShortfall(ctx, order.id, { method: "accept_shortfall", note: "Customer agreed to substitution" }));
    const lines = await shortfalls(order.id);
    expect(lines.every((l) => l.status === "resolved")).toBe(true);
    const accepted = lines.find((l) => l.ingredient_key === target.key)!;
    expect(accepted).toMatchObject({ resolution: "accepted_shortfall", resolution_note: "Customer agreed to substitution" });
    expect(await stock(target.itemId)).toBe(0);
  });

  it("only authorized roles at the order's location can resolve", async () => {
    const cook = await memberOf(ORG_A, "sf-cook-resolve", "KITCHEN_STAFF", [MARINA]);
    const otherBm = await memberOf(ORG_A, "sf-bm-jvc-resolve", "BRANCH_MANAGER", ["loc_jvc"]);
    const { order } = await orderShortOn(0);
    await asUser(cook, (ctx) => performOrderAction(ctx, order.id, { action: "accept" }));

    await expect(asUser(cook, (ctx) => resolveOrderShortfall(ctx, order.id, { method: "accept_shortfall", note: "x" }))).rejects.toMatchObject({ status: 403 });
    await expect(rawAs(cook, (db) => db`select public.resolve_order_shortfall(${order.id}, 'accept_shortfall', 'x')`)).rejects.toMatchObject({ status: 403 });
    await expect(rawAs(otherBm, (db) => db`select public.resolve_order_shortfall(${order.id}, 'accept_shortfall', 'x')`)).rejects.toMatchObject({ status: 404 });
    await expect(rawAs(cook, (db) => db`update order_inventory_shortfalls set status = 'resolved', resolution = 'accepted_shortfall' where order_id = ${order.id}`)).rejects.toMatchObject({ status: 403 });
    expect((await shortfalls(order.id)).every((l) => l.status === "open")).toBe(true);
  });
});

describe("shortfall data is location-scoped", () => {
  it("members of other locations cannot see an order's shortfall lines", async () => {
    const otherBm = await memberOf(ORG_A, "sf-bm-jvc-read", "BRANCH_MANAGER", ["loc_jvc"]);
    const { order } = await orderShortOn(0);
    await system((db) => db`select public.apply_order_transition(${order.id}, 'accept', null, null, null, 'test')`);
    expect((await shortfalls(order.id)).length).toBeGreaterThan(0);
    const visible = await rawAs(otherBm, (db) => db`select count(*)::int n from order_inventory_shortfalls where order_id = ${order.id}`);
    expect(visible[0].n).toBe(0);
  });
});
