import type { OrderChannel } from "../channels/types";

export interface MenuCategory {
  id: string;
  organizationId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeLine {
  inventoryItemKey: string; // key shared by the same ingredient across locations
  quantity: number; // in the ingredient's unit, per 1 menu item
}

export interface MenuItem {
  id: string;
  organizationId: string;
  categoryId: string;
  name: string;
  description: string;
  sku: string;
  price: number;
  foodCost: number;
  /** Manually set availability (86'd). Inventory may additionally block it per location. */
  isAvailable: boolean;
  prepTimeMinutes: number;
  taxRate: number;
  imageEmoji: string;
  popularity: number; // relative weight for demo traffic
  tags: string[];
  recipe: RecipeLine[];
  createdAt: string;
  updatedAt: string;
}

export type MappingStatus = "synced" | "pending" | "out_of_sync" | "missing" | "error";

export interface MenuChannelMapping {
  id: string;
  organizationId: string;
  menuItemId: string;
  channel: OrderChannel;
  externalItemId: string | null;
  externalName: string | null;
  channelPrice: number | null;
  status: MappingStatus;
  lastSyncedAt: string | null;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

export const MAPPING_STATUS_LABEL: Record<MappingStatus, string> = {
  synced: "Synced",
  pending: "Syncing",
  out_of_sync: "Out of sync",
  missing: "Missing",
  error: "Error",
};

export function foodCostPct(item: Pick<MenuItem, "price" | "foodCost">): number {
  return item.price ? (item.foodCost / item.price) * 100 : 0;
}
