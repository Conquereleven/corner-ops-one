import "server-only";
import { hoursUntilStockout, usageRates } from "@/domain/inventory/forecast";
import { movementInputSchema, stockStatus, type MovementInput, type StockStatus } from "@/domain/inventory/types";
import type { LocationScope } from "@/domain/locations/types";
import { round2 } from "@/lib/rng";
import { HOUR, iso } from "@/lib/time";
import { newId } from "../store/backend";
import { ConflictError, DEMO_USER_ID, inScope, live, NotFoundError, ordersBetween } from "./context";

export async function getInventory(scope: LocationScope) {
  const rt = await live();
  const now = Date.now();
  const { db } = rt;
  const rates = usageRates(ordersBetween(rt, "all", now - 4 * HOUR, now + 1), db.menuItems, now);
  const items = db.inventoryItems
    .filter((i) => inScope(scope, i.locationId))
    .map((i) => {
      const status = stockStatus(i);
      const rate = rates.get(`${i.locationId}:${i.key}`);
      const usedBy = db.menuItems.filter((m) => m.recipe.some((r) => r.inventoryItemKey === i.key));
      return {
        ...i,
        status,
        usagePerHour: rate ?? 0,
        hoursLeft: hoursUntilStockout(i, rate),
        usedBy: usedBy.map((m) => ({ id: m.id, name: m.name })),
        /** Menu items this ingredient makes unavailable right now. */
        blocking: usedBy
          .filter((m) => i.quantity < (m.recipe.find((r) => r.inventoryItemKey === i.key)?.quantity ?? 0))
          .map((m) => ({ id: m.id, name: m.name })),
      };
    });
  const counts: Record<StockStatus, number> = { healthy: 0, low: 0, critical: 0, out: 0 };
  for (const i of items) counts[i.status] += 1;
  const itemIds = new Set(items.map((i) => i.id));
  const movements = db.inventoryMovements
    .filter((m) => itemIds.has(m.inventoryItemId))
    .slice(-120)
    .reverse();
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
  };
}
export type InventoryData = Awaited<ReturnType<typeof getInventory>>;
export type InventoryItemView = InventoryData["items"][number];

export { movementInputSchema };

export async function recordMovement(input: MovementInput) {
  const rt = await live();
  const { db } = rt;
  const item = db.inventoryItems.find((i) => i.id === input.inventoryItemId);
  if (!item) throw new NotFoundError("Inventory item");
  const now = iso(Date.now());
  const magnitude = Math.abs(input.quantity);
  const signed =
    input.type === "purchase" ? magnitude : input.type === "adjustment" ? input.quantity : -magnitude;
  if (item.quantity + signed < -0.0001) {
    throw new ConflictError(`Only ${item.quantity} ${item.unit} of ${item.name} in stock.`);
  }
  const apply = (target: typeof item, qty: number, note?: string) => {
    target.quantity = round2(Math.max(0, target.quantity + qty));
    target.updatedAt = now;
    db.inventoryMovements.push({
      id: newId(db, "mov"),
      organizationId: db.organization.id,
      locationId: target.locationId,
      inventoryItemId: target.id,
      type: input.type,
      quantity: round2(qty),
      note,
      createdBy: DEMO_USER_ID,
      createdAt: now,
      updatedAt: now,
    });
  };
  if (input.type === "transfer") {
    const target = db.inventoryItems.find((i) => i.key === item.key && i.locationId === input.targetLocationId);
    if (!target || target.id === item.id) throw new ConflictError("Choose a different destination location for the transfer.");
    const fromName = db.locations.find((l) => l.id === item.locationId)?.name;
    const toName = db.locations.find((l) => l.id === target.locationId)?.name;
    apply(item, -magnitude, input.note || `Transfer to ${toName}`);
    apply(target, magnitude, input.note || `Transfer from ${fromName}`);
  } else {
    apply(item, signed, input.note);
  }
  return { ...item, status: stockStatus(item) };
}
