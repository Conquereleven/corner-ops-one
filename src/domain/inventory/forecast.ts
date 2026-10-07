import { HOUR, toMs } from "@/lib/time";
import type { MenuItem } from "../menu/types";
import type { UnifiedOrder } from "../orders/types";
import type { InventoryItem } from "./types";
import { recipeUsage } from "./usage";

/**
 * Recent hourly consumption per `${locationId}:${ingredientKey}`, from the
 * orders accepted in the lookback window.
 */
export function usageRates(
  orders: UnifiedOrder[],
  menu: MenuItem[],
  now: number,
  lookbackHours = 3,
): Map<string, number> {
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const since = now - lookbackHours * HOUR;
  const totals = new Map<string, number>();
  for (const o of orders) {
    const t = toMs(o.acceptedAt);
    if (!t || t < since || o.status === "cancelled") continue;
    for (const [key, qty] of recipeUsage(o, menuById)) {
      const k = `${o.locationId}:${key}`;
      totals.set(k, (totals.get(k) ?? 0) + qty);
    }
  }
  for (const [k, v] of totals) totals.set(k, v / lookbackHours);
  return totals;
}

/** Hours of stock left at the current burn rate (null when not being consumed). */
export function hoursUntilStockout(item: InventoryItem, ratePerHour: number | undefined): number | null {
  if (item.quantity <= 0) return 0;
  if (!ratePerHour || ratePerHour <= 0) return null;
  return item.quantity / ratePerHour;
}
