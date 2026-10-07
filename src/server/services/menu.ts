import "server-only";
import { z } from "zod";
import { ORDER_CHANNELS, orderChannelSchema, type OrderChannel } from "@/domain/channels/types";
import { itemAvailabilityAt } from "@/domain/inventory/usage";
import type { LocationScope } from "@/domain/locations/types";
import { foodCostPct } from "@/domain/menu/types";
import { iso, startOfDubaiDay, toMs } from "@/lib/time";
import { appendChannelLog } from "../store/backend";
import type { Runtime } from "../store/runtime";
import { inScope, live, NotFoundError } from "./context";

const SYNC_DELAY_MS = 2500;

/** Simulated marketplace menu publishing: pending syncs settle after a short delay. */
function settlePendingSyncs(rt: Runtime, now: number) {
  for (const m of rt.db.menuMappings) {
    const requested = m.status === "pending" ? toMs(m.updatedAt) : undefined;
    if (requested && now - requested >= SYNC_DELAY_MS && m.message === "Publishing to channel…") {
      const item = rt.db.menuItems.find((i) => i.id === m.menuItemId)!;
      m.status = "synced";
      m.externalItemId ??= `${m.channel.toUpperCase().slice(0, 3)}-${item.sku}`;
      m.externalName = item.name;
      m.channelPrice = item.price;
      m.lastSyncedAt = iso(now);
      m.message = undefined;
      m.updatedAt = iso(now);
      appendChannelLog(rt.db, { channel: m.channel, level: "info", message: `Menu item "${item.name}" published (simulated)`, at: iso(now) });
    }
  }
}

export async function getMenu(scope: LocationScope) {
  const rt = await live();
  const now = Date.now();
  settlePendingSyncs(rt, now);
  const { db } = rt;
  const todayStart = startOfDubaiDay(now);
  const soldToday = new Map<string, number>();
  for (const o of db.orders) {
    if ((toMs(o.placedAt) ?? 0) < todayStart || o.status === "cancelled" || !inScope(scope, o.locationId)) continue;
    for (const l of o.items) if (l.menuItemId) soldToday.set(l.menuItemId, (soldToday.get(l.menuItemId) ?? 0) + l.quantity);
  }
  const locations = db.locations.filter((l) => inScope(scope, l.id));
  const stockByLocation = new Map(
    locations.map((l) => [l.id, new Map(db.inventoryItems.filter((i) => i.locationId === l.id).map((i) => [i.key, i]))]),
  );

  const items = db.menuItems.map((item) => ({
    ...item,
    foodCostPct: foodCostPct(item),
    soldToday: soldToday.get(item.id) ?? 0,
    mappings: ORDER_CHANNELS.map((ch) => db.menuMappings.find((m) => m.menuItemId === item.id && m.channel === ch)!),
    availability: locations.map((l) => ({ locationId: l.id, ...itemAvailabilityAt(item, stockByLocation.get(l.id)!) })),
  }));

  const mappingSummary = ORDER_CHANNELS.map((ch) => {
    const list = db.menuMappings.filter((m) => m.channel === ch);
    return {
      channel: ch,
      synced: list.filter((m) => m.status === "synced").length,
      issues: list.filter((m) => m.status !== "synced" && m.status !== "pending").length,
      pending: list.filter((m) => m.status === "pending").length,
      total: list.length,
    };
  });

  return { categories: db.menuCategories, items, mappingSummary };
}
export type MenuData = Awaited<ReturnType<typeof getMenu>>;
export type MenuItemView = MenuData["items"][number];

export const menuItemPatchSchema = z
  .object({
    isAvailable: z.boolean(),
    price: z.number().positive().max(10_000),
    prepTimeMinutes: z.number().int().min(0).max(120),
    description: z.string().max(400),
  })
  .partial();

export async function updateMenuItem(id: string, patch: z.infer<typeof menuItemPatchSchema>) {
  const rt = await live();
  const item = rt.db.menuItems.find((i) => i.id === id);
  if (!item) throw new NotFoundError("Menu item");
  const now = iso(Date.now());
  Object.assign(item, patch, { updatedAt: now });
  if (patch.price !== undefined) {
    for (const m of rt.db.menuMappings.filter((m) => m.menuItemId === id && m.status !== "missing")) {
      if (m.channelPrice !== item.price) {
        m.status = "out_of_sync";
        m.message = `Channel price AED ${m.channelPrice} ≠ master AED ${item.price}`;
        m.updatedAt = now;
      }
    }
  }
  if (patch.isAvailable !== undefined) {
    for (const ch of ORDER_CHANNELS) {
      appendChannelLog(rt.db, {
        channel: ch,
        level: "info",
        message: `"${item.name}" marked ${patch.isAvailable ? "available" : "unavailable"} (simulated availability push)`,
        at: now,
      });
    }
  }
  return item;
}

export const menuSyncSchema = z.object({
  channel: orderChannelSchema,
  menuItemId: z.string().optional(),
});

export async function syncMenu(input: z.infer<typeof menuSyncSchema>) {
  const rt = await live();
  const now = iso(Date.now());
  const targets = rt.db.menuMappings.filter(
    (m) => m.channel === input.channel && (!input.menuItemId || m.menuItemId === input.menuItemId) && m.status !== "synced",
  );
  if (input.menuItemId && !rt.db.menuItems.some((i) => i.id === input.menuItemId)) throw new NotFoundError("Menu item");
  for (const m of targets) {
    m.status = "pending";
    m.message = "Publishing to channel…";
    m.updatedAt = now;
  }
  appendChannelLog(rt.db, {
    channel: input.channel as OrderChannel,
    level: "info",
    message: `Menu publish requested for ${targets.length} item(s) (simulated)`,
    at: now,
  });
  return { queued: targets.length };
}
