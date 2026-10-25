import type { InventoryItem, InventoryMovement, InventoryUnit, MovementType } from "@/domain/inventory/types";
import type { Db } from "../db/client";
import { nullify, num, optStr, str } from "./mappers";

export interface UsageResult {
  inventoryItemId: string;
  ingredientKey: string;
  itemName: string;
  locationId: string;
  unit: string;
  threshold: number;
  beforeQuantity: number;
  afterQuantity: number;
  requestedQuantity: number;
  shortfallQuantity: number;
}

export interface InventoryRepository {
  items(locationIds: string[]): Promise<InventoryItem[]>;
  findItem(id: string): Promise<InventoryItem | null>;
  findByKey(locationId: string, key: string): Promise<InventoryItem | null>;
  movements(locationIds: string[], limit: number): Promise<InventoryMovement[]>;
  /** Manual stock movement through the database operation (validation, locking, event and audit in one step). */
  recordMovement(input: { inventoryItemId: string; type: MovementType; quantity: number; note?: string; targetLocationId?: string }): Promise<{ id: string; quantity: number }>;
  /** Re-run recipe consumption for an accepted order (idempotent; normally done by the transition itself). */
  applyOrderUsage(orderId: string, actorLabel: string): Promise<UsageResult[]>;
}

export const mapInventoryItem = (r: Record<string, unknown>): InventoryItem => ({
  id: str(r.id),
  key: str(r.ingredient_key),
  organizationId: str(r.organization_id),
  locationId: str(r.location_id),
  name: str(r.name),
  category: str(r.category),
  unit: str(r.unit) as InventoryUnit,
  quantity: num(r.quantity),
  threshold: num(r.threshold),
  parLevel: num(r.par_level),
  unitCost: r.unit_cost === undefined || r.unit_cost === null ? undefined : num(r.unit_cost),
  supplier: str(r.supplier),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const mapMovement = (r: Record<string, unknown>): InventoryMovement => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  locationId: str(r.location_id),
  inventoryItemId: str(r.inventory_item_id),
  type: str(r.type) as MovementType,
  quantity: num(r.quantity),
  note: optStr(r.note),
  orderId: optStr(r.order_id),
  actorUserId: optStr(r.actor_user_id) ?? null,
  actorLabel: str(r.actor_label),
  reason: optStr(r.reason),
  requestedQuantity: r.requested_quantity === null || r.requested_quantity === undefined ? undefined : num(r.requested_quantity),
  shortfallQuantity: num(r.shortfall_quantity),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export function movementRow(m: InventoryMovement) {
  return nullify({
    id: m.id,
    organization_id: m.organizationId,
    location_id: m.locationId,
    inventory_item_id: m.inventoryItemId,
    type: m.type,
    quantity: m.quantity,
    note: m.note,
    order_id: m.orderId,
    actor_user_id: m.actorUserId,
    actor_label: m.actorLabel,
    reason: m.reason,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  });
}

/** Readable item columns; unit_cost is finance-only (see financial_inventory_costs). */
const ITEM_COLUMNS = ["id", "organization_id", "location_id", "ingredient_key", "name", "category", "unit", "quantity", "threshold",
  "par_level", "supplier", "created_at", "updated_at"].join(", ");

export function createInventoryRepository(db: Db, organizationId: string, opts: { financials?: boolean } = {}): InventoryRepository {
  const cols = db.unsafe(ITEM_COLUMNS);
  const withCosts = async (items: InventoryItem[]) => {
    if (!opts.financials || !items.length) return items;
    const costs = new Map((await db`select inventory_item_id, unit_cost from public.financial_inventory_costs(${organizationId})`).map((r) => [str(r.inventory_item_id), num(r.unit_cost)]));
    for (const i of items) i.unitCost = costs.get(i.id);
    return items;
  };
  return {
    async items(locationIds) {
      if (!locationIds.length) return [];
      const rows = await db`select ${cols} from public.inventory_items where organization_id = ${organizationId} and location_id = any(${locationIds}) order by location_id, name`;
      return withCosts(rows.map(mapInventoryItem));
    },
    async findItem(id) {
      const rows = await db`select ${cols} from public.inventory_items where id = ${id} and organization_id = ${organizationId}`;
      return rows[0] ? (await withCosts([mapInventoryItem(rows[0])]))[0] : null;
    },
    async findByKey(locationId, key) {
      const rows = await db`select ${cols} from public.inventory_items where organization_id = ${organizationId} and location_id = ${locationId} and ingredient_key = ${key}`;
      return rows[0] ? (await withCosts([mapInventoryItem(rows[0])]))[0] : null;
    },
    async recordMovement(input) {
      const [r] = await db`
        select public.record_inventory_movement(${input.inventoryItemId}, ${input.type}, ${input.quantity}, ${input.note ?? null}, ${input.targetLocationId ?? null}) as result`;
      const res = r.result as { id: string; quantity: number };
      return { id: String(res.id), quantity: Number(res.quantity) };
    },
    async movements(locationIds, limit) {
      if (!locationIds.length) return [];
      const rows = await db`
        select * from public.inventory_movements
        where organization_id = ${organizationId} and location_id = any(${locationIds})
        order by created_at desc limit ${limit}`;
      return rows.map(mapMovement);
    },
    async applyOrderUsage(orderId, actorLabel) {
      const rows = await db`select * from public.apply_order_inventory_usage(${orderId}, ${actorLabel})`;
      return rows.map((r) => ({
        inventoryItemId: str(r.inventory_item_id),
        ingredientKey: str(r.ingredient_key),
        itemName: str(r.item_name),
        locationId: str(r.location_id),
        unit: str(r.unit),
        threshold: num(r.threshold),
        beforeQuantity: num(r.before_quantity),
        afterQuantity: num(r.after_quantity),
        requestedQuantity: num(r.requested_quantity),
        shortfallQuantity: num(r.shortfall_quantity),
      }));
    },
  };
}
