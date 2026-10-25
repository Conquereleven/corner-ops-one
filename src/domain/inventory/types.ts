import { z } from "zod";

export type InventoryUnit = "kg" | "L" | "pcs" | "bunch";

export interface InventoryItem {
  id: string;
  /** Ingredient key shared across locations (recipes reference this). */
  key: string;
  organizationId: string;
  locationId: string;
  name: string;
  category: string;
  unit: InventoryUnit;
  quantity: number;
  threshold: number;
  parLevel: number;
  /** Finance-only; undefined for roles without profitability access. */
  unitCost?: number;
  supplier: string;
  createdAt: string;
  updatedAt: string;
}

export const MOVEMENT_TYPES = ["purchase", "usage", "adjustment", "waste", "transfer"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface InventoryMovement {
  id: string;
  organizationId: string;
  locationId: string;
  inventoryItemId: string;
  type: MovementType;
  /** Signed quantity change applied to stock. */
  quantity: number;
  note?: string;
  orderId?: string;
  /** Auth user who made the change (null for system/simulator activity). */
  actorUserId?: string | null;
  /** 'user', 'system', 'simulator' or a seed label. */
  actorLabel: string;
  reason?: string;
  /** Recipe demand for order usage (may exceed the deducted quantity). */
  requestedQuantity?: number;
  /** Demand that could not be met from stock (never invented as negative stock). */
  shortfallQuantity?: number;
  createdAt: string;
  updatedAt: string;
}

export type StockStatus = "healthy" | "low" | "critical" | "out";

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  healthy: "Healthy",
  low: "Low",
  critical: "Critical",
  out: "Out of stock",
};

export function stockStatus(item: Pick<InventoryItem, "quantity" | "threshold">): StockStatus {
  if (item.quantity <= 0.0001) return "out";
  if (item.quantity <= item.threshold * 0.5) return "critical";
  if (item.quantity <= item.threshold) return "low";
  return "healthy";
}

export const movementInputSchema = z.object({
  inventoryItemId: z.string().min(1),
  type: z.enum(MOVEMENT_TYPES),
  /** Always positive from the form; direction is derived from type (adjustment may be signed). */
  quantity: z.number().finite().refine((v) => v !== 0, "Quantity cannot be zero").refine((v) => Math.abs(v) < 100000),
  note: z.string().max(200).optional(),
  targetLocationId: z.string().optional(),
});
export type MovementInput = z.infer<typeof movementInputSchema>;
