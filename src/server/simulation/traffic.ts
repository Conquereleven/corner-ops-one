import type { MockOrderSpec } from "@/adapters/types";
import { MARKETPLACE_CHANNELS, ORDER_CHANNELS, type OrderChannel } from "@/domain/channels/types";
import type { Customer } from "@/domain/locations/types";
import type { UnifiedOrder } from "@/domain/orders/types";
import { round2, type Rng } from "@/lib/rng";
import { CHANNEL_BEHAVIOUR, LOCATIONS, MODIFIERS, ORDER_NOTES } from "../seed/catalog";
import type { Database } from "../store/types";

export function maskPhone(phone: string, channel: OrderChannel): string {
  if (!(MARKETPLACE_CHANNELS as readonly string[]).includes(channel)) return phone;
  const digits = phone.replace(/\D/g, "");
  return `+971 ${digits.slice(3, 5)} ••• ${digits.slice(-4)}`;
}

/** Pick a channel for a location, weighted by its channel mix and live connection coverage. */
export function pickChannel(db: Database, rng: Rng, locationId: string): OrderChannel | null {
  const seed = LOCATIONS.find((l) => l.id === locationId);
  if (!seed) return null;
  const candidates = ORDER_CHANNELS.filter((ch) =>
    db.channelConnections.some((c) => c.channel === ch && c.locationId === locationId),
  );
  const weights = candidates.map((ch) => seed.channelShare[ch] ?? 0);
  if (!weights.some((w) => w > 0)) return null;
  return rng.weighted(candidates, weights);
}

export function pickLocation(db: Database, rng: Rng): string {
  return rng.weighted(
    LOCATIONS.map((l) => l.id),
    LOCATIONS.map((l) => l.dailyOrders),
  );
}

/**
 * Compose what a customer ordered on a platform, using only items that are
 * actually listed (mapped) on that channel and sellable with current stock.
 * Returns null when nothing can be ordered (e.g. every main is out of stock).
 */
export function buildOrderSpec(
  db: Database,
  rng: Rng,
  args: { locationId: string; channel: OrderChannel; placedAt: number; customer?: Customer },
): MockOrderSpec | null {
  const conn = db.channelConnections.find((c) => c.channel === args.channel && c.locationId === args.locationId);
  if (!conn) throw new Error(`${args.channel} is not connected at ${args.locationId}`);
  const behaviour = CHANNEL_BEHAVIOUR[args.channel];
  const listed = db.menuMappings
    .filter((m) => m.channel === args.channel && m.externalItemId && m.status !== "missing")
    .map((m) => ({ mapping: m, item: db.menuItems.find((i) => i.id === m.menuItemId)! }))
    .filter((x) => x.item && x.item.isAvailable && sellableAt(db, x.item.recipe, args.locationId));
  const mains = listed.filter((x) => !["cat_drinks", "cat_sides", "cat_desserts", "cat_starters"].includes(x.item.categoryId));
  const extras = listed.filter((x) => ["cat_sides", "cat_desserts", "cat_starters"].includes(x.item.categoryId));
  const drinks = listed.filter((x) => x.item.categoryId === "cat_drinks");

  if (!mains.length) return null;
  const picks: typeof listed = [];
  const mainCount = Math.max(1, Math.round(rng.float(0.7, 1.9) + behaviour.extraLines * rng.next()));
  for (let i = 0; i < mainCount; i++) picks.push(rng.weighted(mains, mains.map((m) => m.item.popularity)));
  if (extras.length && rng.chance(0.45 + behaviour.extraLines * 0.2)) picks.push(rng.weighted(extras, extras.map((m) => m.item.popularity)));
  if (drinks.length && rng.chance(0.55)) picks.push(rng.weighted(drinks, drinks.map((m) => m.item.popularity)));

  const lines = new Map<string, MockOrderSpec["lines"][number]>();
  for (const p of picks) {
    const existing = lines.get(p.item.id);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    const mods = MODIFIERS[p.item.categoryId] ?? [];
    const modifiers = mods.length && rng.chance(0.28) ? [rng.pick(mods)] : [];
    lines.set(p.item.id, {
      externalItemId: p.mapping.externalItemId!,
      name: p.mapping.externalName ?? p.item.name,
      quantity: rng.chance(0.18) ? 2 : 1,
      unitPrice: p.mapping.channelPrice ?? p.item.price,
      modifiers,
      notes: rng.chance(0.05) ? "Make it extra spicy" : undefined,
    });
  }
  const lineList = [...lines.values()];
  const subtotal = lineList.reduce(
    (s, l) => s + (l.unitPrice + l.modifiers.reduce((m, x) => m + x.price, 0)) * l.quantity,
    0,
  );
  const discount = rng.chance(behaviour.promoChance)
    ? round2(Math.min(behaviour.promoCap, subtotal * behaviour.promoPct))
    : 0;
  const fulfillment = rng.chance(0.06) ? "pickup" : "delivery";
  const customer = args.customer ?? rng.pick(db.customers);
  const payment: MockOrderSpec["payment"] = rng.chance(behaviour.cashShare)
    ? "cash"
    : args.channel === "whatsapp"
      ? "link"
      : rng.chance(0.3)
        ? "apple_pay"
        : "online";

  db.counters.externalSequence += 1;
  return {
    externalStoreId: conn.externalStoreId,
    placedAt: args.placedAt,
    sequence: db.counters.externalSequence,
    lines: lineList,
    discount,
    deliveryFee: fulfillment === "pickup" ? 0 : behaviour.deliveryFee,
    fulfillment,
    payment,
    customer: { name: customer.name, phone: maskPhone(customer.phone, args.channel) },
    notes: rng.chance(0.12) ? rng.pick(ORDER_NOTES) : undefined,
  };
}

/** An item can be sold at a location only if every recipe ingredient is in stock there. */
function sellableAt(db: Database, recipe: { inventoryItemKey: string; quantity: number }[], locationId: string): boolean {
  return recipe.every((r) => {
    const stock = db.inventoryItems.find((i) => i.locationId === locationId && i.key === r.inventoryItemKey);
    return !stock || stock.quantity >= r.quantity;
  });
}

/** Link a normalized order to a known CornerOps customer (by first name + last 4 digits). */
export function linkCustomer(db: Database, order: UnifiedOrder): void {
  const phone = order.customer?.phone ?? "";
  const tail = phone.replace(/\D/g, "").slice(-4);
  const first = order.customer?.name?.split(" ")[0];
  if (!tail || !first) return;
  const match = db.customers.find((c) => c.phone.endsWith(tail) && c.name.startsWith(first));
  // Marketplaces only share first names and masked phones; keep what the platform sent.
  if (match && order.customer) order.customer.id = match.id;
}
