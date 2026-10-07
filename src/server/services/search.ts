import "server-only";
import { channelName } from "@/domain/channels/types";
import { live } from "./context";

export async function search(q: string) {
  const rt = await live();
  const term = q.trim().toLowerCase();
  if (term.length < 2) return { orders: [], menu: [], inventory: [] };
  const { db } = rt;
  const loc = (id: string) => db.locations.find((l) => l.id === id)?.name ?? "";
  const orders = [];
  for (let i = db.orders.length - 1; i >= 0 && orders.length < 8; i--) {
    const o = db.orders[i];
    const hay = `${o.orderNumber} ${o.externalOrderId} ${o.customer?.name ?? ""} ${o.items.map((x) => x.name).join(" ")}`.toLowerCase();
    if (hay.includes(term)) {
      orders.push({ id: o.id, title: `${o.orderNumber} · ${channelName(o.channel)}`, subtitle: `${o.externalOrderId} · ${o.customer?.name ?? "Guest"} · ${loc(o.locationId)}`, status: o.status });
    }
  }
  const menu = db.menuItems
    .filter((m) => `${m.name} ${m.sku}`.toLowerCase().includes(term))
    .slice(0, 6)
    .map((m) => ({ id: m.id, title: m.name, subtitle: `${m.sku} · AED ${m.price}` }));
  const inventory = db.inventoryItems
    .filter((i) => i.name.toLowerCase().includes(term))
    .slice(0, 6)
    .map((i) => ({ id: i.id, title: i.name, subtitle: `${loc(i.locationId)} · ${i.quantity} ${i.unit}` }));
  return { orders, menu, inventory };
}
export type SearchData = Awaited<ReturnType<typeof search>>;
