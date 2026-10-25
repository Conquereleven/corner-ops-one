import "server-only";
import { z } from "zod";
import { ORDER_CHANNELS, orderChannelSchema } from "@/domain/channels/types";
import { itemAvailabilityAt } from "@/domain/inventory/usage";
import { foodCostPct, type MenuItem } from "@/domain/menu/types";
import { iso, startOfDubaiDay, toMs } from "@/lib/time";
import { requirePermission, type AppContext } from "../context/app-context";
import { NotFoundError } from "../errors";

const SYNC_DELAY_MS = 2500;
const PUBLISHING = "Publishing to channel…";

/** Simulated marketplace publishing: pending syncs settle after a short delay. */
async function settlePendingSyncs(ctx: AppContext) {
  if (!ctx.permissions.has("menu.manage")) return;
  const { items, mappings } = await ctx.data.menu();
  for (const m of mappings) {
    const requested = m.status === "pending" && m.message === PUBLISHING ? toMs(m.updatedAt) : undefined;
    if (!requested || ctx.now - requested < SYNC_DELAY_MS) continue;
    const item = items.find((i) => i.id === m.menuItemId)!;
    Object.assign(m, {
      status: "synced",
      externalItemId: m.externalItemId ?? `${m.channel.toUpperCase().slice(0, 3)}-${item.sku}`,
      externalName: item.name,
      channelPrice: item.price,
      lastSyncedAt: iso(ctx.now),
      message: undefined,
      updatedAt: iso(ctx.now),
    });
    await ctx.repos.menu.updateMapping(m);
    await ctx.repos.channels.insertLogs([{ channel: m.channel, level: "info", message: `Menu item "${item.name}" published (simulated)`, at: iso(ctx.now) }]);
  }
}

export async function getMenu(ctx: AppContext) {
  await settlePendingSyncs(ctx);
  const now = ctx.now;
  const [{ categories, items, mappings }, today, inventory] = await Promise.all([
    ctx.data.menu(),
    ctx.data.orders({ from: startOfDubaiDay(now), to: now + 1, withItems: true }),
    ctx.data.inventory(),
  ]);
  const soldToday = new Map<string, number>();
  for (const o of today) {
    if (o.status === "cancelled") continue;
    for (const l of o.items) if (l.menuItemId) soldToday.set(l.menuItemId, (soldToday.get(l.menuItemId) ?? 0) + l.quantity);
  }
  const locations = ctx.allowedLocations.filter((l) => ctx.scope.locationIds.includes(l.id));
  const stockByLocation = new Map(locations.map((l) => [l.id, new Map(inventory.filter((i) => i.locationId === l.id).map((i) => [i.key, i]))]));

  return {
    categories,
    items: items.map((item) => ({
      ...item,
      foodCostPct: foodCostPct(item),
      soldToday: soldToday.get(item.id) ?? 0,
      mappings: ORDER_CHANNELS.map((ch) => mappings.find((m) => m.menuItemId === item.id && m.channel === ch)!).filter(Boolean),
      availability: locations.map((l) => ({ locationId: l.id, ...itemAvailabilityAt(item, stockByLocation.get(l.id)!) })),
    })),
    mappingSummary: ORDER_CHANNELS.map((ch) => {
      const list = mappings.filter((m) => m.channel === ch);
      return {
        channel: ch,
        synced: list.filter((m) => m.status === "synced").length,
        issues: list.filter((m) => m.status !== "synced" && m.status !== "pending").length,
        pending: list.filter((m) => m.status === "pending").length,
        total: list.length,
      };
    }),
    canManage: ctx.permissions.has("menu.manage"),
  };
}
export type MenuData = Awaited<ReturnType<typeof getMenu>>;
export type MenuItemView = MenuData["items"][number];

export const menuItemPatchSchema = z
  .object({
    isAvailable: z.boolean(),
    price: z.number().positive().max(10_000),
    prepTimeMinutes: z.number().int().min(0).max(120),
    description: z.string().trim().max(400),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const snapshot = (i: MenuItem) => ({ isAvailable: i.isAvailable, price: i.price, prepTimeMinutes: i.prepTimeMinutes, description: i.description });

export async function updateMenuItem(ctx: AppContext, id: string, patch: z.infer<typeof menuItemPatchSchema>) {
  requirePermission(ctx, "menu.manage");
  const before = await ctx.repos.menu.findItem(id);
  if (!before) throw new NotFoundError("Menu item");
  const after = await ctx.repos.menu.updateItem(id, patch);
  const now = iso(Date.now());

  if (patch.price !== undefined && patch.price !== before.price) {
    for (const m of (await ctx.repos.menu.mappings()).filter((m) => m.menuItemId === id && m.status !== "missing" && m.channelPrice !== after.price)) {
      await ctx.repos.menu.updateMapping({ ...m, status: "out_of_sync", message: `Channel price AED ${m.channelPrice} ≠ master AED ${after.price}`, updatedAt: now });
    }
  }
  const availabilityChanged = patch.isAvailable !== undefined && patch.isAvailable !== before.isAvailable;
  if (availabilityChanged) {
    await ctx.repos.channels.insertLogs(
      ORDER_CHANNELS.map((channel) => ({ channel, level: "info" as const, message: `"${after.name}" marked ${after.isAvailable ? "available" : "unavailable"} (simulated availability push)`, at: now })),
    );
  }
  await ctx.repos.events.append(
    {
      type: availabilityChanged ? "menu.availability_changed" : "menu.item_updated",
      aggregateType: "menu_item",
      aggregateId: id,
      payload: { name: after.name, sku: after.sku, changes: patch },
    },
    ctx.actor,
  );
  await ctx.repos.audit.record(
    { action: availabilityChanged ? "menu.availability_changed" : "menu.item_updated", entityType: "menu_item", entityId: id, before: snapshot(before), after: snapshot(after), metadata: { name: after.name, sku: after.sku } },
    ctx.actor,
  );
  return after;
}

export const menuSyncSchema = z.object({
  channel: orderChannelSchema,
  menuItemId: z.string().optional(),
});

export async function syncMenu(ctx: AppContext, input: z.infer<typeof menuSyncSchema>) {
  requirePermission(ctx, "menu.manage");
  if (input.menuItemId && !(await ctx.repos.menu.findItem(input.menuItemId))) throw new NotFoundError("Menu item");
  const now = iso(Date.now());
  const targets = (await ctx.repos.menu.mappings()).filter(
    (m) => m.channel === input.channel && (!input.menuItemId || m.menuItemId === input.menuItemId) && m.status !== "synced",
  );
  for (const m of targets) await ctx.repos.menu.updateMapping({ ...m, status: "pending", message: PUBLISHING, updatedAt: now });
  await ctx.repos.channels.insertLogs([{ channel: input.channel, level: "info", message: `Menu publish requested for ${targets.length} item(s) (simulated)`, at: now }]);
  if (targets.length) {
    await ctx.repos.audit.record(
      { action: "menu.publish_requested", entityType: "channel", entityId: input.channel, metadata: { items: targets.map((t) => t.menuItemId), simulated: true } },
      ctx.actor,
    );
  }
  return { queued: targets.length };
}
