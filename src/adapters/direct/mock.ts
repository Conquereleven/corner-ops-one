import { specTotals } from "../shared/build-order";
import { MockChannelAdapter, isoFromSpec } from "../shared/mock-adapter";
import type { MockOrderSpec, MockPlatformBackend } from "../types";
import { normalizeDirectOrder } from "./normalize";
import type { DirectOrder } from "./schema";

function fabricate(spec: MockOrderSpec): DirectOrder {
  const t = specTotals(spec);
  return {
    id: `WEB-${(310_000 + spec.sequence).toString()}`,
    storeSlug: spec.externalStoreId,
    createdAt: isoFromSpec(spec),
    fulfillment: spec.fulfillment,
    customer: spec.customer,
    lineItems: spec.lines.map((l) => ({
      menuSku: l.externalItemId,
      name: l.name,
      qty: l.quantity,
      price: l.unitPrice,
      options: l.modifiers,
      note: l.notes,
    })),
    totals: { subtotal: t.subtotal, promo: t.discount, delivery: spec.deliveryFee, vat: t.tax, total: t.total },
    payment: {
      provider: spec.payment === "cash" ? "cash" : spec.payment === "apple_pay" ? "apple_pay" : "card",
      status: spec.payment === "cash" ? "pending" : "authorized",
    },
    note: spec.notes,
  };
}

export function createDirectMockAdapter(backend: MockPlatformBackend) {
  return new MockChannelAdapter<DirectOrder>(
    {
      channel: "direct",
      fabricate,
      normalize: normalizeDirectOrder,
      baseLatencyMs: 60,
      statusMap: {
        accepted: "confirmed",
        preparing: "preparing",
        ready: "ready",
        picked_up: "out_for_delivery",
        completed: "fulfilled",
        cancelled: "refunded",
      },
    },
    backend,
  );
}
