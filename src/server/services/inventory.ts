import "server-only";
import { hoursUntilStockout, usageRates } from "@/domain/inventory/forecast";
import { movementInputSchema, stockStatus, type MovementInput, type StockStatus } from "@/domain/inventory/types";
import { round2 } from "@/lib/rng";
import { HOUR } from "@/lib/time";
import { requireLocationAccess, requirePermission, type AppContext } from "../context/app-context";
import { ConflictError, NotFoundError } from "../errors";

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
    // Finance-only: null when unit costs are not available to this role.
    stockValue: items.some((i) => i.unitCost === undefined) ? null : round2(items.reduce((s, i) => s + i.quantity * (i.unitCost ?? 0), 0)),
    canManage: ctx.permissions.has("inventory.manage"),
  };
}
export type InventoryData = Awaited<ReturnType<typeof getInventory>>;
export type InventoryItemView = InventoryData["items"][number];

export { movementInputSchema };

/**
 * Record a stock movement through the database operation `record_inventory_movement`:
 * it re-checks role and location, locks the item(s), refuses movements that
 * would make stock negative, and writes the movement, event and audit entry
 * (actor, time, organization, location, reason, quantity) atomically.
 */
export async function recordMovement(ctx: AppContext, input: MovementInput) {
  requirePermission(ctx, "inventory.manage");
  const item = await ctx.repos.inventory.findItem(input.inventoryItemId);
  if (!item) throw new NotFoundError("Inventory item");
  requireLocationAccess(ctx, item.locationId);
  if (input.type === "transfer") {
    if (!input.targetLocationId || input.targetLocationId === item.locationId) throw new ConflictError("Choose a different destination location for the transfer.");
    requireLocationAccess(ctx, input.targetLocationId);
  }
  await ctx.repos.inventory.recordMovement({
    inventoryItemId: item.id,
    type: input.type,
    quantity: input.quantity,
    note: input.note || undefined,
    targetLocationId: input.type === "transfer" ? input.targetLocationId : undefined,
  });
  const after = (await ctx.repos.inventory.findItem(item.id))!;
  return { ...after, status: stockStatus(after) };
}
