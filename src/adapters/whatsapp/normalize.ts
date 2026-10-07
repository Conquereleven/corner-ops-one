import type { UnifiedOrder } from "@/domain/orders/types";
import { round2 } from "@/lib/rng";
import { buildUnifiedOrder } from "../shared/build-order";
import type { NormalizationContext } from "../types";
import { whatsappOrderSchema } from "./schema";

/** WhatsApp carts carry no computed totals, so the normalizer derives them (VAT 5%). */
export function normalizeWhatsAppOrder(external: unknown, ctx: NormalizationContext): UnifiedOrder {
  const o = whatsappOrderSchema.parse(external);
  const subtotal = round2(o.cart.reduce((s, c) => s + (c.price + c.extrasPrice) * c.qty, 0));
  const discount = Math.min(o.discount, subtotal);
  const tax = round2((subtotal - discount) * 0.05);
  return buildUnifiedOrder(
    {
      channel: "whatsapp",
      externalOrderId: `WA-${o.messageId.slice(-6).toUpperCase()}`,
      externalStoreId: o.branch,
      placedAt: o.receivedAt,
      fulfillment: o.orderType,
      paymentMethod: o.paymentPreference === "cash" ? "cash_on_delivery" : "payment_link",
      customer: { name: o.customerWaName, phone: o.customerWaPhone },
      lines: o.cart.map((c) => {
        const perExtra = c.extras.length ? round2(c.extrasPrice / c.extras.length) : 0;
        return {
          externalItemId: c.catalogItemId,
          name: c.name,
          quantity: c.qty,
          unitPrice: c.price,
          modifiers: c.extras.map((e) => ({ name: e, price: perExtra })),
        };
      }),
      subtotal,
      discount,
      deliveryFee: o.deliveryCharge,
      tax,
      total: round2(subtotal - discount + o.deliveryCharge + tax),
      notes: o.notes,
      courierProvider: "restaurant",
      metadata: { whatsapp: { conversationId: o.conversationId } },
    },
    ctx,
  );
}
