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
}

export interface InventoryRepository {
  items(locationIds: string[]): Promise<InventoryItem[]>;
  findItem(id: string, opts?: { forUpdate?: boolean }): Promise<InventoryItem | null>;
  findByKey(locationId: string, key: string, opts?: { forUpdate?: boolean }): Promise<InventoryItem | null>;
  setQuantity(id: string, quantity: number): Promise<void>;
  insertMovement(m: InventoryMovement): Promise<void>;
  movements(locationIds: string[], limit: number): Promise<InventoryMovement[]>;
  /** Atomically deduct an accepted order's recipe usage (idempotent per order). */
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
  unitCost: num(r.unit_cost),
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

export function createInventoryRepository(db: Db, organizationId: string): InventoryRepository {
  return {
    async items(locationIds) {
      if (!locationIds.length) return [];
      const rows = await db`select * from public.inventory_items where organization_id = ${organizationId} and location_id = any(${locationIds}) order by location_id, name`;
      return rows.map(mapInventoryItem);
    },
    async findItem(id, opts = {}) {
      const rows = opts.forUpdate
        ? await db`select * from public.inventory_items where id = ${id} and organization_id = ${organizationId} for update`
        : await db`select * from public.inventory_items where id = ${id} and organization_id = ${organizationId}`;
      return rows[0] ? mapInventoryItem(rows[0]) : null;
    },
    async findByKey(locationId, key, opts = {}) {
      const rows = opts.forUpdate
        ? await db`select * from public.inventory_items where organization_id = ${organizationId} and location_id = ${locationId} and ingredient_key = ${key} for update`
        : await db`select * from public.inventory_items where organization_id = ${organizationId} and location_id = ${locationId} and ingredient_key = ${key}`;
      return rows[0] ? mapInventoryItem(rows[0]) : null;
    },
    async setQuantity(id, quantity) {
      const rows = await db`update public.inventory_items set quantity = ${quantity} where id = ${id} and organization_id = ${organizationId} returning id`;
      if (!rows.length) throw Object.assign(new Error("inventory not updated"), { code: "42501" });
    },
    async insertMovement(m) {
      await db`insert into public.inventory_movements ${db(movementRow(m))}`;
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
      }));
    },
  };
}
