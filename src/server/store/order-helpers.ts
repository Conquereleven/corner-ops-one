import { CHANNEL_CATALOG } from "@/domain/channels/types";
import { recipeUsage } from "@/domain/inventory/usage";
import type { UnifiedOrder } from "@/domain/orders/types";
import { round2 } from "@/lib/rng";
import { iso } from "@/lib/time";
import { linkCustomer } from "../simulation/traffic";
import { newId } from "./backend";
import type { Database } from "./types";

/** Enrich a freshly normalized order with CornerOps-side knowledge. */
export function finalizeIngestedOrder(db: Database, order: UnifiedOrder): UnifiedOrder {
  linkCustomer(db, order);
  if (order.platformFee === undefined && CHANNEL_CATALOG[order.channel].kind === "marketplace") {
    const rate = db.settings.economics[order.channel].commissionRate;
    order.platformFee = round2(rate * (order.subtotal - order.discount));
    order.metadata = { ...order.metadata, platformFeeEstimated: true };
  }
  return order;
}

export function insertOrder(db: Database, order: UnifiedOrder) {
  db.orders.push(order);
  db.ordersById.set(order.id, order);
}

export function replaceOrder(db: Database, order: UnifiedOrder) {
  const idx = db.orders.findIndex((o) => o.id === order.id);
  if (idx >= 0) db.orders[idx] = order;
  db.ordersById.set(order.id, order);
}

/** Deduct recipe ingredients from the order's location stock and log usage movements. */
export function consumeInventoryForOrder(db: Database, order: UnifiedOrder, at: number) {
  const menuById = new Map(db.menuItems.map((m) => [m.id, m]));
  const usage = recipeUsage(order, menuById);
  for (const [key, qty] of usage) {
    const stock = db.inventoryItems.find((i) => i.locationId === order.locationId && i.key === key);
    if (!stock) continue;
    stock.quantity = round2(Math.max(0, stock.quantity - qty));
    stock.updatedAt = iso(at);
    db.inventoryMovements.push({
      id: newId(db, "mov"),
      organizationId: db.organization.id,
      locationId: order.locationId,
      inventoryItemId: stock.id,
      type: "usage",
      quantity: -round2(qty),
      orderId: order.id,
      note: `${order.orderNumber} · ${CHANNEL_CATALOG[order.channel].shortName}`,
      actorLabel: "system",
      createdAt: iso(at),
      updatedAt: iso(at),
    });
  }
  if (db.inventoryMovements.length > 5000) db.inventoryMovements.splice(0, db.inventoryMovements.length - 5000);
}
