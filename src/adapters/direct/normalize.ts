import type { UnifiedOrder } from "@/domain/orders/types";
import { buildUnifiedOrder } from "../shared/build-order";
import type { NormalizationContext } from "../types";
import { directOrderSchema } from "./schema";

export function normalizeDirectOrder(external: unknown, ctx: NormalizationContext): UnifiedOrder {
  const o = directOrderSchema.parse(external);
  return buildUnifiedOrder(
    {
      channel: "direct",
      externalOrderId: o.id,
      externalStoreId: o.storeSlug,
      placedAt: o.createdAt,
      fulfillment: o.fulfillment,
      paymentMethod: o.payment.provider === "cash" ? "cash_on_delivery" : o.payment.provider === "apple_pay" ? "apple_pay" : "card_online",
      customer: o.customer,
      lines: o.lineItems.map((l) => ({
        externalItemId: l.menuSku,
        name: l.name,
        quantity: l.qty,
        unitPrice: l.price,
        modifiers: l.options,
        notes: l.note,
      })),
      subtotal: o.totals.subtotal,
      discount: o.totals.promo,
      deliveryFee: o.totals.delivery,
      tax: o.totals.vat,
      total: o.totals.total,
      notes: o.note,
      courierProvider: "restaurant",
      metadata: { direct: { paymentStatus: o.payment.status } },
    },
    ctx,
  );
}
