import type { OrderChannel } from "@/domain/channels/types";
import type { OrderStatus, UnifiedOrder, UnifiedOrderItem } from "@/domain/orders/types";
import type { Db } from "../db/client";
import { chunk, nullify, num, optNum, optStr, str } from "./mappers";

export interface OrderQuery {
  locationIds: string[];
  placedFrom?: number;
  placedTo?: number;
  statuses?: OrderStatus[];
  channel?: OrderChannel;
  withItems?: boolean;
  limit?: number;
  orderBy?: "placed_desc" | "placed_asc";
}

export interface OrderRepository {
  findById(id: string, opts?: { forUpdate?: boolean }): Promise<UnifiedOrder | null>;
  findByOrderNumber(orderNumber: string): Promise<UnifiedOrder | null>;
  list(query: OrderQuery): Promise<UnifiedOrder[]>;
  search(term: string, locationIds: string[], limit: number): Promise<UnifiedOrder[]>;
  /** Idempotent insert: orders whose (organization, channel, external id) already exists are skipped. */
  insertMany(orders: UnifiedOrder[]): Promise<UnifiedOrder[]>;
  update(order: UnifiedOrder): Promise<UnifiedOrder>;
  countForCustomer(customerId: string): Promise<number>;
  firstPlacedAt(locationIds: string[]): Promise<number | null>;
}

const ITEMS_JSON = `coalesce((select json_agg(json_build_object(
  'id', i.id, 'menuItemId', i.menu_item_id, 'externalItemId', i.external_item_id, 'name', i.name,
  'quantity', i.quantity, 'unitPrice', i.unit_price, 'modifiers', i.modifiers, 'notes', i.notes, 'total', i.total
) order by i.id) from public.order_items i where i.order_id = o.id), '[]'::json)`;

export function mapOrder(r: Record<string, unknown>): UnifiedOrder {
  const items = (r.items as Record<string, unknown>[] | undefined) ?? [];
  return {
    id: str(r.id),
    orderNumber: str(r.order_number),
    externalOrderId: str(r.external_order_id),
    organizationId: str(r.organization_id),
    restaurantId: str(r.restaurant_id),
    locationId: str(r.location_id),
    channel: str(r.channel_id) as OrderChannel,
    status: str(r.status) as OrderStatus,
    fulfillment: str(r.fulfillment) as UnifiedOrder["fulfillment"],
    customer:
      r.customer_id || r.customer_name || r.customer_phone
        ? { id: optStr(r.customer_id), name: optStr(r.customer_name), phone: optStr(r.customer_phone) }
        : undefined,
    items: items.map(
      (i): UnifiedOrderItem => ({
        id: str(i.id),
        menuItemId: optStr(i.menuItemId),
        externalItemId: optStr(i.externalItemId),
        name: str(i.name),
        quantity: num(i.quantity),
        unitPrice: num(i.unitPrice),
        modifiers: (i.modifiers as UnifiedOrderItem["modifiers"]) ?? [],
        notes: optStr(i.notes),
        total: num(i.total),
      }),
    ),
    subtotal: num(r.subtotal),
    discount: num(r.discount),
    deliveryFee: num(r.delivery_fee),
    platformFee: optNum(r.platform_fee),
    tax: num(r.tax),
    total: num(r.total),
    paymentMethod: str(r.payment_method) as UnifiedOrder["paymentMethod"],
    estimatedPrepMinutes: num(r.estimated_prep_minutes),
    notes: optStr(r.notes),
    courier: (r.courier as UnifiedOrder["courier"]) ?? undefined,
    placedAt: str(r.placed_at),
    acceptedAt: optStr(r.accepted_at),
    preparationStartedAt: optStr(r.preparation_started_at),
    readyAt: optStr(r.ready_at),
    pickedUpAt: optStr(r.picked_up_at),
    completedAt: optStr(r.completed_at),
    cancelledAt: optStr(r.cancelled_at),
    cancellationReason: optStr(r.cancellation_reason),
    syncStatus: str(r.sync_status) as UnifiedOrder["syncStatus"],
    source: str(r.source) as UnifiedOrder["source"],
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

export function orderRow(o: UnifiedOrder) {
  return nullify({
    id: o.id,
    organization_id: o.organizationId,
    restaurant_id: o.restaurantId,
    location_id: o.locationId,
    order_number: o.orderNumber,
    external_order_id: o.externalOrderId,
    channel_id: o.channel,
    status: o.status,
    fulfillment: o.fulfillment,
    customer_id: o.customer?.id,
    customer_name: o.customer?.name,
    customer_phone: o.customer?.phone,
    subtotal: o.subtotal,
    discount: o.discount,
    delivery_fee: o.deliveryFee,
    platform_fee: o.platformFee,
    tax: o.tax,
    total: o.total,
    payment_method: o.paymentMethod,
    estimated_prep_minutes: o.estimatedPrepMinutes,
    notes: o.notes,
    courier: o.courier ?? null,
    placed_at: o.placedAt,
    accepted_at: o.acceptedAt,
    preparation_started_at: o.preparationStartedAt,
    ready_at: o.readyAt,
    picked_up_at: o.pickedUpAt,
    completed_at: o.completedAt,
    cancelled_at: o.cancelledAt,
    cancellation_reason: o.cancellationReason,
    sync_status: o.syncStatus,
    source: o.source,
    metadata: o.metadata ?? {},
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  });
}

export function orderItemRows(o: UnifiedOrder) {
  return o.items.map((i) =>
    nullify({
      id: i.id,
      organization_id: o.organizationId,
      order_id: o.id,
      location_id: o.locationId,
      menu_item_id: i.menuItemId,
      external_item_id: i.externalItemId,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      modifiers: JSON.stringify(i.modifiers),
      notes: i.notes,
      total: i.total,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
    }),
  );
}

export function createOrderRepository(db: Db, organizationId: string): OrderRepository {
  const select = (withItems: boolean) => db.unsafe(`o.*, ${withItems ? ITEMS_JSON : "'[]'::json"} as items`);

  return {
    async findById(id, opts = {}) {
      if (opts.forUpdate) {
        const locked = await db`select id from public.orders where id = ${id} and organization_id = ${organizationId} for update`;
        if (!locked.length) return null;
      }
      const rows = await db`select ${select(true)} from public.orders o where o.id = ${id} and o.organization_id = ${organizationId}`;
      return rows[0] ? mapOrder(rows[0]) : null;
    },

    async findByOrderNumber(orderNumber) {
      const rows = await db`select ${select(true)} from public.orders o where o.order_number = ${orderNumber} and o.organization_id = ${organizationId}`;
      return rows[0] ? mapOrder(rows[0]) : null;
    },

    async list(q) {
      if (!q.locationIds.length) return [];
      const rows = await db`
        select ${select(!!q.withItems)} from public.orders o
        where o.organization_id = ${organizationId}
          and o.location_id = any(${q.locationIds})
          ${q.placedFrom !== undefined ? db`and o.placed_at >= ${new Date(q.placedFrom).toISOString()}` : db``}
          ${q.placedTo !== undefined ? db`and o.placed_at < ${new Date(q.placedTo).toISOString()}` : db``}
          ${q.statuses?.length ? db`and o.status = any(${q.statuses})` : db``}
          ${q.channel ? db`and o.channel_id = ${q.channel}` : db``}
        order by o.placed_at ${q.orderBy === "placed_desc" ? db`desc` : db`asc`}
        ${q.limit ? db`limit ${q.limit}` : db``}`;
      return rows.map(mapOrder);
    },

    async search(term, locationIds, limit) {
      if (!locationIds.length) return [];
      const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const rows = await db`
        select ${select(true)} from public.orders o
        where o.organization_id = ${organizationId} and o.location_id = any(${locationIds})
          and (o.order_number ilike ${like} or o.external_order_id ilike ${like} or o.customer_name ilike ${like}
               or exists (select 1 from public.order_items i where i.order_id = o.id and i.name ilike ${like}))
        order by o.placed_at desc limit ${limit}`;
      return rows.map(mapOrder);
    },

    async insertMany(orders) {
      if (!orders.length) return [];
      const inserted = new Set<string>();
      for (const batch of chunk(orders, 500)) {
        const rows = await db`
          insert into public.orders ${db(batch.map(orderRow))}
          on conflict (organization_id, channel_id, external_order_id) do nothing
          returning id`;
        rows.forEach((r) => inserted.add(String(r.id)));
      }
      const created = orders.filter((o) => inserted.has(o.id));
      const items = created.flatMap(orderItemRows);
      for (const batch of chunk(items, 1000)) await db`insert into public.order_items ${db(batch)}`;
      return created;
    },

    async update(order) {
      const r = orderRow(order);
      const rows = await db`
        update public.orders set
          status = ${r.status}, accepted_at = ${r.accepted_at}, preparation_started_at = ${r.preparation_started_at},
          ready_at = ${r.ready_at}, picked_up_at = ${r.picked_up_at}, completed_at = ${r.completed_at},
          cancelled_at = ${r.cancelled_at}, cancellation_reason = ${r.cancellation_reason},
          courier = ${r.courier as never}, sync_status = ${r.sync_status}, metadata = ${r.metadata as never},
          updated_at = ${r.updated_at}
        where id = ${order.id} and organization_id = ${organizationId}
        returning id`;
      if (!rows.length) throw Object.assign(new Error("order not updated"), { code: "P0002" });
      return order;
    },

    async firstPlacedAt(locationIds) {
      if (!locationIds.length) return null;
      const [r] = await db`select min(placed_at) as first from public.orders where organization_id = ${organizationId} and location_id = any(${locationIds})`;
      return r?.first ? Date.parse(String(r.first)) : null;
    },

    async countForCustomer(customerId) {
      const [r] = await db`select count(*)::int as n from public.orders where organization_id = ${organizationId} and customer_id = ${customerId}`;
      return Number(r.n);
    },
  };
}
