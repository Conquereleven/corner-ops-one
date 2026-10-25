import type { OrderChannel } from "@/domain/channels/types";
import type { OrderShortfallLine, OrderStatus, UnifiedOrder, UnifiedOrderItem } from "@/domain/orders/types";
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
  findById(id: string): Promise<UnifiedOrder | null>;
  findByOrderNumber(orderNumber: string): Promise<UnifiedOrder | null>;
  list(query: OrderQuery): Promise<UnifiedOrder[]>;
  search(term: string, locationIds: string[], limit: number): Promise<UnifiedOrder[]>;
  /** Idempotent insert: orders whose (organization, channel, external id) already exists are skipped. */
  insertMany(orders: UnifiedOrder[]): Promise<UnifiedOrder[]>;
  /** Status change through the database operation (state machine, inventory, event and audit in one step). */
  transition(orderId: string, action: string, opts: TransitionOptions): Promise<{ id: string; status: OrderStatus }>;
  /** Simulator-only bookkeeping (system connections). */
  setMetadata(orderId: string, metadata: Record<string, unknown>): Promise<void>;
  shortfalls(orderId: string): Promise<OrderShortfallLine[]>;
  resolveShortfall(orderId: string, method: "reconcile_from_stock" | "accept_shortfall", note?: string): Promise<{ resolved: number; open: number }>;
  countForCustomer(customerId: string): Promise<number>;
  firstPlacedAt(locationIds: string[]): Promise<number | null>;
}

export interface TransitionOptions {
  reason?: string;
  syncStatus?: UnifiedOrder["syncStatus"];
  courier?: UnifiedOrder["courier"];
  actorLabel?: string;
  channelSync?: { ok: boolean; externalStatus: string };
}


/** Every readable column. platform_fee is a finance-only column (see financial_order_fees). */
const ORDER_COLUMNS = [
  "id", "organization_id", "restaurant_id", "location_id", "order_number", "external_order_id", "channel_id", "status", "fulfillment",
  "customer_id", "customer_name", "customer_phone", "subtotal", "discount", "delivery_fee", "tax", "total", "payment_method",
  "estimated_prep_minutes", "notes", "courier", "placed_at", "accepted_at", "preparation_started_at", "ready_at", "picked_up_at",
  "completed_at", "cancelled_at", "cancellation_reason", "sync_status", "source", "metadata", "created_at", "updated_at",
].map((c) => `o.${c}`).join(", ");

const SHORTFALL_STATE = `(select case when bool_or(s.status = 'open') then 'open' else 'resolved' end
  from public.order_inventory_shortfalls s where s.order_id = o.id) as inventory_shortfall`;

const ITEMS_JSON = `coalesce((select json_agg(json_build_object(
  'id', i.id, 'menuItemId', i.menu_item_id, 'externalItemId', i.external_item_id, 'name', i.name,
  'quantity', i.quantity, 'unitPrice', i.unit_price, 'modifiers', i.modifiers, 'notes', i.notes, 'total', i.total
) order by i.id) from public.order_items i where i.order_id = o.id), '[]'::json)`;

function parseModifiers(v: unknown): UnifiedOrderItem["modifiers"] {
  if (Array.isArray(v)) return v as UnifiedOrderItem["modifiers"];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

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
        modifiers: parseModifiers(i.modifiers),
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
    inventoryShortfall: (optStr(r.inventory_shortfall) as UnifiedOrder["inventoryShortfall"]) ?? undefined,
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

/** `json` wraps jsonb values for the driver (postgres.js would otherwise send arrays as SQL arrays). */
export function orderItemRows(o: UnifiedOrder, json: (v: unknown) => unknown) {
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
      modifiers: json(i.modifiers),
      notes: i.notes,
      total: i.total,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
    }),
  );
}

export function createOrderRepository(db: Db, organizationId: string, opts: { financials?: boolean } = {}): OrderRepository {
  const select = (withItems: boolean) => db.unsafe(`${ORDER_COLUMNS}, ${SHORTFALL_STATE}, ${withItems ? ITEMS_JSON : "'[]'::json"} as items`);

  /** Finance roles get platform commission merged in; the database refuses everyone else. */
  const withFees = async (orders: UnifiedOrder[]) => {
    if (!opts.financials || !orders.length) return orders;
    const fees = new Map<string, number | undefined>();
    for (const batch of chunk(orders.map((o) => o.id), 5000)) {
      const rows = await db`select order_id, platform_fee from public.financial_order_fees(${organizationId}, ${batch})`;
      for (const r of rows) fees.set(str(r.order_id), optNum(r.platform_fee));
    }
    for (const o of orders) o.platformFee = fees.get(o.id);
    return orders;
  };
  const one = async (rows: Record<string, unknown>[]) => (rows[0] ? (await withFees([mapOrder(rows[0])]))[0] : null);

  return {
    async findById(id) {
      return one(await db`select ${select(true)} from public.orders o where o.id = ${id} and o.organization_id = ${organizationId}`);
    },

    async findByOrderNumber(orderNumber) {
      return one(await db`select ${select(true)} from public.orders o where o.order_number = ${orderNumber} and o.organization_id = ${organizationId}`);
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
      return withFees(rows.map(mapOrder));
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
      return withFees(rows.map(mapOrder));
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
      const items = created.flatMap((o) => orderItemRows(o, (v) => db.json(v as never)));
      for (const batch of chunk(items, 1000)) await db`insert into public.order_items ${db(batch)}`;
      return created;
    },

    async transition(orderId, action, t) {
      const [r] = await db`
        select public.apply_order_transition(
          ${orderId}, ${action}, ${t.reason ?? null}, ${t.syncStatus ?? null},
          ${t.courier ? db.json(t.courier as never) : null}, ${t.actorLabel ?? null},
          ${t.channelSync ? db.json(t.channelSync as never) : null}) as result`;
      const res = r.result as { id: string; status: OrderStatus };
      return { id: String(res.id), status: res.status };
    },

    async setMetadata(orderId, metadata) {
      await db`update public.orders set metadata = ${db.json(metadata as never)} where id = ${orderId} and organization_id = ${organizationId}`;
    },

    async shortfalls(orderId) {
      const rows = await db`
        select id, inventory_item_id, ingredient_key, unit, requested_quantity, consumed_quantity, unmet_quantity, status, resolution, resolution_note, resolved_at
        from public.order_inventory_shortfalls where order_id = ${orderId} and organization_id = ${organizationId} order by ingredient_key`;
      return rows.map((r) => ({
        id: str(r.id),
        inventoryItemId: optStr(r.inventory_item_id),
        ingredientKey: str(r.ingredient_key),
        unit: optStr(r.unit),
        requestedQuantity: num(r.requested_quantity),
        consumedQuantity: num(r.consumed_quantity),
        unmetQuantity: num(r.unmet_quantity),
        status: str(r.status) as OrderShortfallLine["status"],
        resolution: optStr(r.resolution) as OrderShortfallLine["resolution"],
        resolutionNote: optStr(r.resolution_note),
        resolvedAt: optStr(r.resolved_at),
      }));
    },

    async resolveShortfall(orderId, method, note) {
      const [r] = await db`select public.resolve_order_shortfall(${orderId}, ${method}, ${note ?? null}) as result`;
      const res = r.result as { resolved: number; open: number };
      return { resolved: Number(res.resolved), open: Number(res.open) };
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
