import type { MenuItem } from "../menu/types";
import type { UnifiedOrder } from "../orders/types";
import type { InventoryItem, StockStatus } from "./types";
import { stockStatus } from "./types";

/** Ingredient consumption (by ingredient key) implied by an order's items. */
export function recipeUsage(
  order: Pick<UnifiedOrder, "items">,
  menuById: Map<string, MenuItem>,
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const line of order.items) {
    const item = line.menuItemId ? menuById.get(line.menuItemId) : undefined;
    if (!item) continue;
    for (const r of item.recipe) {
      usage.set(r.inventoryItemKey, (usage.get(r.inventoryItemKey) ?? 0) + r.quantity * line.quantity);
    }
  }
  return usage;
}

export interface ItemAvailability {
  available: boolean;
  /** Ingredients that block the item at this location. */
  blockedBy: { key: string; name: string; status: StockStatus }[];
  /** Ingredients running low (not yet blocking). */
  atRisk: { key: string; name: string; status: StockStatus }[];
}

/** Whether a menu item can be sold at a location given current stock. */
export function itemAvailabilityAt(
  item: MenuItem,
  stockByKey: Map<string, InventoryItem>,
): ItemAvailability {
  const blockedBy: ItemAvailability["blockedBy"] = [];
  const atRisk: ItemAvailability["atRisk"] = [];
  for (const r of item.recipe) {
    const stock = stockByKey.get(r.inventoryItemKey);
    if (!stock) continue;
    const status = stockStatus(stock);
    if (stock.quantity < r.quantity) blockedBy.push({ key: stock.key, name: stock.name, status: "out" });
    else if (status === "critical" || status === "low") atRisk.push({ key: stock.key, name: stock.name, status });
  }
  return { available: item.isAvailable && blockedBy.length === 0, blockedBy, atRisk };
}
