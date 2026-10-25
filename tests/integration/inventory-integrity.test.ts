import { describe, expect, it } from "vitest";
import { getSql } from "@/server/db/client";
import { freshDemoOrder, system } from "../support/helpers";

/** Put an order into "accepted" without consuming stock (simulates a crash between steps). */
async function acceptedWithoutUsage() {
  const order = await freshDemoOrder("loc_marina");
  await system(async (db) => {
    await db`select set_config('cornerops.bypass_order_guard', 'on', true)`;
    await db`update orders set status = 'accepted', accepted_at = now() where id = ${order.id}`;
  });
  return order;
}

const usageRows = (orderId: string) => system((db) => db`select inventory_item_id, quantity, requested_quantity, shortfall_quantity from inventory_movements where order_id = ${orderId} and type = 'usage' order by inventory_item_id`);

describe("order inventory usage", () => {
  it("is refused for orders that have not been accepted (or were cancelled)", async () => {
    const order = await freshDemoOrder("loc_marina");
    const res = await system((db) => db`select * from public.apply_order_inventory_usage(${order.id}, 'test')`).then(
      (r) => ({ ok: true as const, rows: r.length }),
      (e) => ({ ok: false as const, e }),
    );
    if (res.ok) expect(res.rows).toBe(0);
    expect(await usageRows(order.id)).toEqual([]);
  });

  it("concurrent calls consume exactly once", async () => {
    const order = await acceptedWithoutUsage();
    const sql = getSql();
    const call = () => sql.begin((tx) => tx`select * from public.apply_order_inventory_usage(${order.id}, 'race')`).catch(() => []);
    await Promise.all([call(), call(), call(), call()]);
    const rows = await system((db) => db`select inventory_item_id from inventory_movements where order_id = ${order.id} and type = 'usage'`);
    const ids = rows.map((r) => r.inventory_item_id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the database rejects a second usage movement for the same order and item", async () => {
    const order = await acceptedWithoutUsage();
    await system((db) => db`select * from public.apply_order_inventory_usage(${order.id}, 'once')`);
    const [first] = await usageRows(order.id);
    await expect(
      system((db) => db`
        insert into inventory_movements (id, organization_id, location_id, inventory_item_id, type, quantity, order_id, actor_label)
        values ('mov_dup_usage', 'org_cornerops_demo', 'loc_marina', ${first.inventory_item_id}, 'usage', -1, ${order.id}, 'dup')`),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("a shortage records the unmet demand instead of silently clamping", async () => {
    const order = await acceptedWithoutUsage();
    const keys = await system((db) => db`
      select distinct r.ingredient_key from order_items oi join menu_item_recipes r on r.menu_item_id = oi.menu_item_id where oi.order_id = ${order.id}`);
    const key = String(keys[0].ingredient_key);
    await system(async (db) => {
      await db`select set_config('cornerops.bypass_inventory_guard', 'on', true)`;
      await db`update inventory_items set quantity = 0 where location_id = 'loc_marina' and ingredient_key = ${key}`;
    });
    await system((db) => db`select * from public.apply_order_inventory_usage(${order.id}, 'shortage')`);
    const [row] = await system((db) => db`
      select m.quantity, m.requested_quantity, m.shortfall_quantity from inventory_movements m
      join inventory_items i on i.id = m.inventory_item_id
      where m.order_id = ${order.id} and m.type = 'usage' and i.ingredient_key = ${key}`);
    expect(Number(row.quantity)).toBe(0);
    expect(Number(row.requested_quantity)).toBeGreaterThan(0);
    expect(Number(row.shortfall_quantity)).toBeCloseTo(Number(row.requested_quantity), 4);
    const [ev] = await system((db) => db`select count(*)::int n from domain_events where aggregate_id = ${order.id} and type = 'inventory.shortfall'`);
    expect(ev.n).toBe(1);
  });
});
