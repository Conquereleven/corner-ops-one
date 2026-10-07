import { MockChannelAdapter } from "../shared/mock-adapter";
import { isoFromSpec } from "../shared/mock-adapter";
import { specTotals } from "../shared/build-order";
import type { MockOrderSpec, MockPlatformBackend } from "../types";
import { normalizeTalabatOrder } from "./normalize";
import type { TalabatOrder } from "./schema";

function fabricate(spec: MockOrderSpec): TalabatOrder {
  const t = specTotals(spec);
  return {
    order_id: `TLB-${(88_120_000 + spec.sequence * 37).toString()}`,
    short_code: (1000 + (spec.sequence % 9000)).toString(),
    vendor_code: spec.externalStoreId,
    created_at: isoFromSpec(spec),
    expedition_type: spec.fulfillment === "pickup" ? "PICKUP" : "TALABAT_DELIVERY",
    customer: { first_name: spec.customer.name.split(" ")[0], phone_masked: spec.customer.phone },
    items: spec.lines.map((l) => ({
      sku: l.externalItemId,
      title: l.name,
      qty: l.quantity,
      unit_price: l.unitPrice,
      options: l.modifiers.map((m) => ({ title: m.name, price: m.price })),
      comment: l.notes,
    })),
    payment: { method: spec.payment === "cash" ? "CASH" : "ONLINE", wallet_used: spec.sequence % 7 === 0 },
    price: {
      subtotal: t.subtotal,
      discount_total: t.discount,
      delivery_fee: spec.deliveryFee,
      vat: t.tax,
      grand_total: t.total,
    },
    special_instructions: spec.notes,
    status: "RECEIVED",
  };
}

export function createTalabatMockAdapter(backend: MockPlatformBackend) {
  return new MockChannelAdapter<TalabatOrder>(
    {
      channel: "talabat",
      fabricate,
      normalize: normalizeTalabatOrder,
      baseLatencyMs: 180,
      statusMap: {
        accepted: "ACCEPTED",
        preparing: "PREPARING",
        ready: "READY_FOR_PICKUP",
        picked_up: "PICKED_UP",
        completed: "DELIVERED",
        cancelled: "REJECTED",
      },
    },
    backend,
  );
}
