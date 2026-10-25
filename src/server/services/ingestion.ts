import type { NormalizationContext } from "@/adapters/types";
import { CHANNEL_CATALOG, ORDER_CHANNELS, type ChannelConnection, type ChannelEconomics, type OrderChannel } from "@/domain/channels/types";
import type { Customer } from "@/domain/locations/types";
import type { MenuChannelMapping, MenuItem } from "@/domain/menu/types";
import type { UnifiedOrder } from "@/domain/orders/types";
import { round2 } from "@/lib/rng";
import type { ChannelRuntime } from "../demo/backend-session";
import type { Db } from "../db/client";
import type { Actor } from "../db/transaction";
import type { Repositories } from "../repositories";
import { newId } from "../repositories/mappers";

export interface IngestionContext {
  organizationId: string;
  restaurantId: string;
  connections: ChannelConnection[];
  mappings: MenuChannelMapping[];
  menuItems: MenuItem[];
  customers: Customer[];
  /** Commission estimate for marketplace orders without a reported fee (system ingestion always has it). */
  economics: Record<OrderChannel, ChannelEconomics> | null;
}

export function buildNormalizationContext(ic: IngestionContext, firstOrderNumber: number, now: number): NormalizationContext {
  const menuById = new Map(ic.menuItems.map((m) => [m.id, m]));
  let next = firstOrderNumber;
  return {
    organizationId: ic.organizationId,
    restaurantId: ic.restaurantId,
    now,
    resolveLocationId: (channel, externalStoreId) =>
      ic.connections.find((c) => c.channel === channel && c.externalStoreId === externalStoreId)?.locationId,
    resolveMenuItemId: (channel, externalItemId) =>
      ic.mappings.find((m) => m.channel === channel && m.externalItemId === externalItemId)?.menuItemId,
    estimatePrepMinutes(menuItemIds) {
      const preps = menuItemIds.map((id) => (id ? menuById.get(id)?.prepTimeMinutes : undefined)).filter((v): v is number => v !== undefined);
      if (!preps.length) return 12;
      return Math.min(25, Math.max(8, Math.round(Math.max(...preps) + 1.5 * (preps.length - 1))));
    },
    allocateOrderNumber: () => `CO-${next++}`,
    newId: (prefix) => newId(prefix),
  };
}

/** Enrich a normalized order with CornerOps-side knowledge (customer link, estimated commission). */
export function enrichOrder(order: UnifiedOrder, ic: Pick<IngestionContext, "customers" | "economics">): UnifiedOrder {
  const tail = (order.customer?.phone ?? "").replace(/\D/g, "").slice(-4);
  const first = order.customer?.name?.split(" ")[0];
  if (tail && first && order.customer) {
    const match = ic.customers.find((c) => c.phone.endsWith(tail) && c.name.startsWith(first));
    if (match) order.customer.id = match.id;
  }
  if (order.platformFee === undefined && ic.economics && CHANNEL_CATALOG[order.channel].kind === "marketplace") {
    order.platformFee = round2(ic.economics[order.channel].commissionRate * (order.subtotal - order.discount));
    order.metadata = { ...order.metadata, platformFeeEstimated: true };
  }
  return order;
}

/**
 * Pull pending orders from every channel adapter, normalize them into
 * UnifiedOrders and persist them idempotently: a payload delivered twice
 * (same organization + channel + external id) never creates a second order.
 * Emits order.received for each order actually created.
 */
export async function ingestPendingOrders(
  db: Db,
  repos: Repositories,
  runtime: ChannelRuntime,
  ic: IngestionContext,
  actor: Actor,
  now: number,
): Promise<UnifiedOrder[]> {
  const pending = ORDER_CHANNELS.reduce((n, ch) => n + (runtime.backend.inboxes[ch]?.length ?? 0), 0);
  if (!pending) return [];
  const [{ first }] = await db`select public.reserve_order_numbers(${ic.organizationId}, ${pending}) as first`;
  const ctx = buildNormalizationContext(ic, Number(first), now);

  const normalized: UnifiedOrder[] = [];
  for (const channel of ORDER_CHANNELS) {
    if (!runtime.backend.inboxes[channel]?.length) continue;
    for (const order of await runtime.adapters[channel].getOrders(ctx)) normalized.push(enrichOrder(order, ic));
  }
  const created = await repos.orders.insertMany(normalized);
  for (const o of created) {
    await repos.events.append(
      {
        type: "order.received",
        aggregateType: "order",
        aggregateId: o.id,
        locationId: o.locationId,
        payload: { orderNumber: o.orderNumber, channel: o.channel, externalOrderId: o.externalOrderId, total: o.total, source: o.source },
      },
      actor,
    );
  }
  return created;
}
