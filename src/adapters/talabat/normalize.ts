import type { UnifiedOrder } from "@/domain/orders/types";
import { buildUnifiedOrder } from "../shared/build-order";
import type { NormalizationContext } from "../types";
import { talabatOrderSchema } from "./schema";

export function normalizeTalabatOrder(external: unknown, ctx: NormalizationContext): UnifiedOrder {
  const o = talabatOrderSchema.parse(external);
  return buildUnifiedOrder(
    {
      channel: "talabat",
      externalOrderId: o.order_id,
      externalStoreId: o.vendor_code,
      placedAt: o.created_at,
      fulfillment: o.expedition_type === "PICKUP" ? "pickup" : "delivery",
      paymentMethod: o.payment.method === "CASH" ? "cash_on_delivery" : o.payment.wallet_used ? "wallet" : "card_online",
      customer: { name: o.customer.first_name, phone: o.customer.phone_masked },
      lines: o.items.map((i) => ({
        externalItemId: i.sku,
        name: i.title,
        quantity: i.qty,
        unitPrice: i.unit_price,
        modifiers: i.options.map((op) => ({ name: op.title, price: op.price })),
        notes: i.comment,
      })),
      subtotal: o.price.subtotal,
      discount: o.price.discount_total,
      deliveryFee: o.price.delivery_fee,
      tax: o.price.vat,
      total: o.price.grand_total,
      notes: o.special_instructions,
      courierProvider: "platform",
      metadata: { talabat: { shortCode: o.short_code, vendorCode: o.vendor_code } },
    },
    ctx,
  );
}
