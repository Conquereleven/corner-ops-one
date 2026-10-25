import "server-only";
import { channelName } from "@/domain/channels/types";
import type { AppContext } from "../context/app-context";

/** Global search, limited to the user's organization, accessible locations and permissions. */
export async function search(ctx: AppContext, q: string) {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return { orders: [], menu: [], inventory: [] };
  const locIds = ctx.allowedLocations.map((l) => l.id);
  const loc = (id: string) => ctx.allowedLocations.find((l) => l.id === id)?.name ?? "";
  const [orders, menu, inventory] = await Promise.all([
    ctx.permissions.has("orders.view") ? ctx.repos.orders.search(term, locIds, 8) : Promise.resolve([]),
    ctx.permissions.has("menu.view") ? ctx.repos.menu.items() : Promise.resolve([]),
    ctx.permissions.has("inventory.view") ? ctx.repos.inventory.items(locIds) : Promise.resolve([]),
  ]);
  return {
    orders: orders.map((o) => ({
      id: o.id,
      title: `${o.orderNumber} · ${channelName(o.channel)}`,
      subtitle: `${o.externalOrderId} · ${o.customer?.name ?? "Guest"} · ${loc(o.locationId)}`,
      status: o.status,
    })),
    menu: menu.filter((m) => `${m.name} ${m.sku}`.toLowerCase().includes(term)).slice(0, 6).map((m) => ({ id: m.id, title: m.name, subtitle: `${m.sku} · AED ${m.price}` })),
    inventory: inventory.filter((i) => i.name.toLowerCase().includes(term)).slice(0, 6).map((i) => ({ id: i.id, title: i.name, subtitle: `${loc(i.locationId)} · ${i.quantity} ${i.unit}` })),
  };
}
export type SearchData = Awaited<ReturnType<typeof search>>;
