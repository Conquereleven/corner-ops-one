import type { UnifiedOrder } from "@/domain/orders/types";
import { iso } from "@/lib/time";
import { buildUnifiedOrder } from "../shared/build-order";
import { fromMinor } from "../shared/money";
import type { NormalizationContext } from "../types";
import { keetaOrderSchema } from "./schema";

export function normalizeKeetaOrder(external: unknown, ctx: NormalizationContext): UnifiedOrder {
  const o = keetaOrderSchema.parse(external);
  return buildUnifiedOrder(
    {
      channel: "keeta",
      externalOrderId: o.orderViewId,
      externalStoreId: String(o.shopId),
      placedAt: iso(o.ctime * 1000),
      fulfillment: o.deliveryType === 2 ? "pickup" : "delivery",
      paymentMethod: o.payType === 2 ? "cash_on_delivery" : "card_online",
      customer: { name: o.recipient.name, phone: `•••• ${o.recipient.phoneTail}` },
      lines: o.products.map((p) => ({
        externalItemId: p.spuId,
        name: p.name,
        quantity: p.count,
        unitPrice: fromMinor(p.price),
        modifiers: p.attrs.map((a) => ({ name: a.name, price: fromMinor(a.price) })),
      })),
      subtotal: fromMinor(o.fee.productAmount),
      discount: fromMinor(o.fee.discountAmount),
      deliveryFee: fromMinor(o.fee.shippingFee),
      tax: fromMinor(o.fee.vatAmount),
      total: fromMinor(o.fee.payAmount),
      notes: o.remark || undefined,
      courierProvider: "platform",
      metadata: { keeta: { orderId: o.orderId, shopId: o.shopId } },
    },
    ctx,
  );
}
