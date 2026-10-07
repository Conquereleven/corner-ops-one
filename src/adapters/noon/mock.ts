import { round2 } from "@/lib/rng";
import { specTotals } from "../shared/build-order";
import { MockChannelAdapter } from "../shared/mock-adapter";
import type { MockOrderSpec, MockPlatformBackend } from "../types";
import { normalizeNoonOrder } from "./normalize";
import type { NoonOrder } from "./schema";

function fabricate(spec: MockOrderSpec): NoonOrder {
  const t = specTotals(spec);
  return {
    orderRef: `NF${(5_230_000 + spec.sequence * 13).toString()}`,
    outletId: spec.externalStoreId,
    orderedAt: spec.placedAt,
    deliveryMode: spec.fulfillment === "pickup" ? "SELF_PICKUP" : "NOON_FLEET",
    customerName: spec.customer.name,
    customerMobile: spec.customer.phone,
    lines: spec.lines.map((l) => ({
      productCode: l.externalItemId,
      productName: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      addOns: l.modifiers.map((m) => ({ label: m.name, amount: m.price })),
      lineTotal: round2((l.unitPrice + l.modifiers.reduce((s, m) => s + m.price, 0)) * l.quantity),
    })),
    amounts: {
      itemsTotal: t.subtotal,
      discount: t.discount,
      deliveryCharge: spec.deliveryFee,
      vatAmount: t.tax,
      payable: t.total,
    },
    paymentMode: spec.payment === "cash" ? "COD" : "PREPAID",
    remarks: spec.notes,
  };
}

export function createNoonMockAdapter(backend: MockPlatformBackend) {
  return new MockChannelAdapter<NoonOrder>(
    {
      channel: "noon",
      fabricate,
      normalize: normalizeNoonOrder,
      baseLatencyMs: 310,
      statusMap: {
        accepted: "CONFIRMED",
        preparing: "PREPARING",
        ready: "READY",
        picked_up: "OUT_FOR_DELIVERY",
        completed: "DELIVERED",
        cancelled: "CANCELLED_BY_OUTLET",
      },
    },
    backend,
  );
}
