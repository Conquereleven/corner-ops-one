import type { OrderChannel } from "@/domain/channels/types";
import type { MappingStatus, MenuCategory, MenuChannelMapping, MenuItem } from "@/domain/menu/types";
import type { Db } from "../db/client";
import { num, optStr, str } from "./mappers";

export interface MenuRepository {
  categories(): Promise<MenuCategory[]>;
  items(): Promise<MenuItem[]>;
  mappings(): Promise<MenuChannelMapping[]>;
  findItem(id: string): Promise<MenuItem | null>;
  updateItem(id: string, patch: Partial<Pick<MenuItem, "isAvailable" | "price" | "prepTimeMinutes" | "description">>): Promise<MenuItem>;
  updateMapping(m: MenuChannelMapping): Promise<void>;
}

const mapItem = (r: Record<string, unknown>): MenuItem => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  categoryId: str(r.category_id),
  name: str(r.name),
  description: str(r.description),
  sku: str(r.sku),
  price: num(r.price),
  foodCost: num(r.food_cost),
  isAvailable: Boolean(r.is_available),
  prepTimeMinutes: num(r.prep_time_minutes),
  taxRate: num(r.tax_rate),
  imageEmoji: str(r.image_emoji),
  popularity: num(r.popularity),
  tags: (r.tags as string[]) ?? [],
  recipe: ((r.recipe as { k: string; q: number }[]) ?? []).map((x) => ({ inventoryItemKey: x.k, quantity: Number(x.q) })),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

const mapMapping = (r: Record<string, unknown>): MenuChannelMapping => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  menuItemId: str(r.menu_item_id),
  channel: str(r.channel_id) as OrderChannel,
  externalItemId: optStr(r.external_item_id) ?? null,
  externalName: optStr(r.external_name) ?? null,
  channelPrice: r.channel_price === null || r.channel_price === undefined ? null : num(r.channel_price),
  status: str(r.status) as MappingStatus,
  lastSyncedAt: optStr(r.last_synced_at) ?? null,
  message: optStr(r.message),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export function createMenuRepository(db: Db, organizationId: string): MenuRepository {
  const itemSelect = db`
    select mi.*, coalesce((select json_agg(json_build_object('k', r.ingredient_key, 'q', r.quantity) order by r.ingredient_key)
      from public.menu_item_recipes r where r.menu_item_id = mi.id), '[]'::json) as recipe
    from public.menu_items mi`;
  return {
    async categories() {
      const rows = await db`select * from public.menu_categories where organization_id = ${organizationId} order by sort_order`;
      return rows.map((r) => ({
        id: str(r.id), organizationId: str(r.organization_id), name: str(r.name), sortOrder: num(r.sort_order),
        createdAt: str(r.created_at), updatedAt: str(r.updated_at),
      }));
    },
    async items() {
      const rows = await db`${itemSelect} where mi.organization_id = ${organizationId} order by mi.sku`;
      return rows.map(mapItem);
    },
    async mappings() {
      const rows = await db`select * from public.menu_channel_mappings where organization_id = ${organizationId} order by menu_item_id, channel_id`;
      return rows.map(mapMapping);
    },
    async findItem(id) {
      const rows = await db`${itemSelect} where mi.organization_id = ${organizationId} and mi.id = ${id}`;
      return rows[0] ? mapItem(rows[0]) : null;
    },
    async updateItem(id, patch) {
      const rows = await db`
        update public.menu_items set
          is_available = coalesce(${patch.isAvailable ?? null}, is_available),
          price = coalesce(${patch.price ?? null}, price),
          prep_time_minutes = coalesce(${patch.prepTimeMinutes ?? null}, prep_time_minutes),
          description = coalesce(${patch.description ?? null}, description)
        where id = ${id} and organization_id = ${organizationId}
        returning id`;
      if (!rows.length) throw Object.assign(new Error("menu item not updated"), { code: "42501" });
      return (await this.findItem(id))!;
    },
    async updateMapping(m) {
      const rows = await db`
        update public.menu_channel_mappings set
          external_item_id = ${m.externalItemId}, external_name = ${m.externalName}, channel_price = ${m.channelPrice},
          status = ${m.status}, last_synced_at = ${m.lastSyncedAt}, message = ${m.message ?? null}, updated_at = ${m.updatedAt}
        where id = ${m.id} and organization_id = ${organizationId}
        returning id`;
      if (!rows.length) throw Object.assign(new Error("mapping not updated"), { code: "42501" });
    },
  };
}
