import type { UnifiedOrder } from "@/domain/orders/types";
import { iso } from "@/lib/time";
import { buildUnifiedOrder } from "../shared/build-order";
import type { NormalizationContext } from "../types";
import { noonOrderSchema } from "./schema";

export function normalizeNoonOrder(external: unknown, ctx: NormalizationContext): UnifiedOrder {
  const o = noonOrderSchema.parse(external);
  return buildUnifiedOrder(
    {
      channel: "noon",
      externalOrderId: o.orderRef,
      externalStoreId: o.outletId,
      placedAt: iso(o.orderedAt),
      fulfillment: o.deliveryMode === "SELF_PICKUP" ? "pickup" : "delivery",
      paymentMethod: o.paymentMode === "COD" ? "cash_on_delivery" : "card_online",
      customer: { name: o.customerName, phone: o.customerMobile },
      lines: o.lines.map((l) => ({
        externalItemId: l.productCode,
        name: l.productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        modifiers: l.addOns.map((a) => ({ name: a.label, price: a.amount })),
      })),
      subtotal: o.amounts.itemsTotal,
      discount: o.amounts.discount,
      deliveryFee: o.amounts.deliveryCharge,
      tax: o.amounts.vatAmount,
      total: o.amounts.payable,
      notes: o.remarks,
      courierProvider: "platform",
      metadata: { noon: { outletId: o.outletId } },
    },
    ctx,
  );
}
