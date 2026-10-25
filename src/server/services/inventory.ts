import "server-only";
import { hoursUntilStockout, usageRates } from "@/domain/inventory/forecast";
import { movementInputSchema, stockStatus, type InventoryItem, type MovementInput, type StockStatus } from "@/domain/inventory/types";
import { round2 } from "@/lib/rng";
import { HOUR, iso } from "@/lib/time";
import { requireLocationAccess, requirePermission, type AppContext } from "../context/app-context";
import { ConflictError, NotFoundError } from "../errors";
import { newId } from "../repositories/mappers";

export async function getInventory(ctx: AppContext) {
  const now = ctx.now;
  const [inventory, recent, { items: menu }, movements] = await Promise.all([
    ctx.data.inventory(),
    ctx.data.orders({ from: now - 4 * HOUR, to: now + 1, withItems: true }),
    ctx.data.menu(),
    ctx.repos.inventory.movements(ctx.scope.locationIds, 120),
  ]);
  const rates = usageRates(recent, menu, now);
  const items = inventory.map((i) => {
    const status = stockStatus(i);
    const rate = rates.get(`${i.locationId}:${i.key}`);
    const usedBy = menu.filter((m) => m.recipe.some((r) => r.inventoryItemKey === i.key));
    return {
      ...i,
      status,
      usagePerHour: rate ?? 0,
      hoursLeft: hoursUntilStockout(i, rate),
      usedBy: usedBy.map((m) => ({ id: m.id, name: m.name })),
      blocking: usedBy
        .filter((m) => i.quantity < (m.recipe.find((r) => r.inventoryItemKey === i.key)?.quantity ?? 0))
        .map((m) => ({ id: m.id, name: m.name })),
    };
  });
  const counts: Record<StockStatus, number> = { healthy: 0, low: 0, critical: 0, out: 0 };
  for (const i of items) counts[i.status] += 1;
  const unavailable = new Map<string, { id: string; name: string; locations: string[]; causes: string[] }>();
  for (const i of items) {
    for (const b of i.blocking) {
      const entry = unavailable.get(b.id) ?? { id: b.id, name: b.name, locations: [], causes: [] };
      if (!entry.locations.includes(i.locationId)) entry.locations.push(i.locationId);
      if (!entry.causes.includes(i.name)) entry.causes.push(i.name);
      unavailable.set(b.id, entry);
    }
  }
  return {
    items,
    counts,
    movements,
    unavailableMenuItems: [...unavailable.values()],
    stockValue: round2(items.reduce((s, i) => s + i.quantity * i.unitCost, 0)),
    canManage: ctx.permissions.has("inventory.manage"),
  };
}
export type InventoryData = Awaited<ReturnType<typeof getInventory>>;
export type InventoryItemView = InventoryData["items"][number];

export { movementInputSchema };

async function emitThresholdEvents(ctx: AppContext, before: InventoryItem, after: InventoryItem) {
  const was = stockStatus(before);
  const now = stockStatus(after);
  if (was === now || (now !== "low" && now !== "out")) return;
  await ctx.repos.events.append(
    {
      type: now === "out" ? "inventory.out_of_stock" : "inventory.low",
      aggregateType: "inventory_item",
      aggregateId: after.id,
      locationId: after.locationId,
      payload: { name: after.name, quantity: after.quantity, threshold: after.threshold, unit: after.unit },
    },
    ctx.actor,
  );
}

/** Record a stock movement. Every movement keeps actor, time, organization, location, reason and quantity. */
export async function recordMovement(ctx: AppContext, input: MovementInput) {
  requirePermission(ctx, "inventory.manage");
  const item = await ctx.repos.inventory.findItem(input.inventoryItemId, { forUpdate: true });
  if (!item) throw new NotFoundError("Inventory item");
  requireLocationAccess(ctx, item.locationId);

  const magnitude = Math.abs(input.quantity);
  const signed = input.type === "purchase" ? magnitude : input.type === "adjustment" ? input.quantity : -magnitude;
  if (item.quantity + signed < -0.0001) throw new ConflictError(`Only ${item.quantity} ${item.unit} of ${item.name} in stock.`);
  const now = iso(Date.now());
  const actorUserId = ctx.actor.kind === "user" ? ctx.actor.userId : null;

  const apply = async (target: InventoryItem, qty: number, note: string | undefined) => {
    const after: InventoryItem = { ...target, quantity: round2(Math.max(0, target.quantity + qty)), updatedAt: now };
    await ctx.repos.inventory.setQuantity(target.id, after.quantity);
    await ctx.repos.inventory.insertMovement({
      id: newId("mov"),
      organizationId: ctx.organization.id,
      locationId: target.locationId,
      inventoryItemId: target.id,
      type: input.type,
      quantity: round2(qty),
      note,
      actorUserId,
      actorLabel: "user",
      reason: input.note ?? input.type,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.repos.events.append(
      {
        type: "inventory.adjusted",
        aggregateType: "inventory_item",
        aggregateId: target.id,
        locationId: target.locationId,
        payload: { name: target.name, type: input.type, quantity: round2(qty), unit: target.unit, from: target.quantity, to: after.quantity },
      },
      ctx.actor,
    );
    await ctx.repos.audit.record(
      {
        action: "inventory.adjusted",
        entityType: "inventory_item",
        entityId: target.id,
        locationId: target.locationId,
        before: { quantity: target.quantity },
        after: { quantity: after.quantity },
        metadata: { type: input.type, quantity: round2(qty), note: note ?? null, name: target.name, unit: target.unit },
      },
      ctx.actor,
    );
    await emitThresholdEvents(ctx, target, after);
    return after;
  };

  if (input.type === "transfer") {
    if (!input.targetLocationId) throw new ConflictError("Choose a destination location for the transfer.");
    requireLocationAccess(ctx, input.targetLocationId);
    const target = await ctx.repos.inventory.findByKey(input.targetLocationId, item.key, { forUpdate: true });
    if (!target || target.id === item.id) throw new ConflictError("Choose a different destination location for the transfer.");
    const fromName = ctx.allowedLocations.find((l) => l.id === item.locationId)?.name;
    const toName = ctx.allowedLocations.find((l) => l.id === target.locationId)?.name;
    const after = await apply(item, -magnitude, input.note || `Transfer to ${toName}`);
    await apply(target, magnitude, input.note || `Transfer from ${fromName}`);
    return { ...after, status: stockStatus(after) };
  }
  const after = await apply(item, signed, input.note);
  return { ...after, status: stockStatus(after) };
}
