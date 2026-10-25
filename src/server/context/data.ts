import type { ChannelConnection } from "@/domain/channels/types";
import type { InventoryItem } from "@/domain/inventory/types";
import type { MenuCategory, MenuChannelMapping, MenuItem } from "@/domain/menu/types";
import { ACTIVE_STATUSES, type UnifiedOrder } from "@/domain/orders/types";
import type { WorkspaceSettings } from "../store/types";
import type { AppContext } from "./app-context";

/**
 * Request-scoped, memoized reads used by services, so composing several
 * computations (overview + alerts + AI snapshot) never re-queries the same data.
 * Everything is limited to the context's scope (allowed locations).
 */
export interface WorkspaceData {
  settings(): Promise<WorkspaceSettings>;
  menu(): Promise<{ categories: MenuCategory[]; items: MenuItem[]; mappings: MenuChannelMapping[] }>;
  inventory(): Promise<InventoryItem[]>;
  connections(): Promise<ChannelConnection[]>;
  /** Orders placed in [from, to) in scope. */
  orders(range: { from: number; to: number; withItems?: boolean }): Promise<UnifiedOrder[]>;
  /** In-flight orders (new → ready) in scope, with items. */
  activeOrders(): Promise<UnifiedOrder[]>;
}

export function createWorkspaceData(ctx: AppContext): WorkspaceData {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!memo.has(key)) memo.set(key, load());
    return memo.get(key) as Promise<T>;
  };
  const ids = () => ctx.scope.locationIds;
  return {
    settings: () => once("settings", () => ctx.repos.organization.settings()),
    menu: () =>
      once("menu", async () => {
        const [categories, items, mappings] = await Promise.all([ctx.repos.menu.categories(), ctx.repos.menu.items(), ctx.repos.menu.mappings()]);
        return { categories, items, mappings };
      }),
    inventory: () => once("inventory", () => ctx.repos.inventory.items(ids())),
    connections: () => once("connections", () => ctx.repos.channels.connections(ids())),
    orders: ({ from, to, withItems = false }) =>
      once(`orders:${from}:${to}:${withItems}`, () => ctx.repos.orders.list({ locationIds: ids(), placedFrom: from, placedTo: to, withItems })),
    activeOrders: () =>
      once("active", () => ctx.repos.orders.list({ locationIds: ids(), statuses: [...ACTIVE_STATUSES], withItems: true })),
  };
}
