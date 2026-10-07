import type { UnifiedOrder } from "@/domain/orders/types";
import { buildUnifiedOrder } from "../shared/build-order";
import { fromMinor } from "../shared/money";
import type { NormalizationContext } from "../types";
import { deliverooOrderSchema } from "./schema";

export function normalizeDeliverooOrder(external: unknown, ctx: NormalizationContext): UnifiedOrder {
  const o = deliverooOrderSchema.parse(external);
  return buildUnifiedOrder(
    {
      channel: "deliveroo",
      externalOrderId: `#${o.display_id}`,
      externalStoreId: o.location_id,
      placedAt: o.placed_at,
      fulfillment: o.fulfillment_type === "customer_collection" ? "pickup" : "delivery",
      paymentMethod: o.cash_due.cents > 0 ? "cash_on_delivery" : "card_online",
      customer: { name: o.customer.first_name, phone: o.customer.contact_number },
      lines: o.items.map((i) => ({
        externalItemId: i.pos_item_id,
        name: i.name,
        quantity: i.quantity,
        unitPrice: fromMinor(i.unit_price.cents),
        modifiers: i.modifiers.map((m) => ({ name: m.name, price: fromMinor(m.unit_price.cents) })),
      })),
      subtotal: fromMinor(o.partner_order_subtotal.cents),
      discount: fromMinor(o.offer_discount.cents),
      deliveryFee: fromMinor(o.delivery_fee.cents),
      tax: fromMinor(o.vat.cents),
      total: fromMinor(o.partner_order_total.cents),
      notes: o.order_notes ?? undefined,
      courierProvider: "platform",
      metadata: { deliveroo: { orderUuid: o.id, siteId: o.location_id } },
    },
    ctx,
  );
}
