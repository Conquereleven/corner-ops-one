import { specTotals } from "../shared/build-order";
import { MockChannelAdapter, isoFromSpec } from "../shared/mock-adapter";
import { toMinor } from "../shared/money";
import type { MockOrderSpec, MockPlatformBackend } from "../types";
import { normalizeDeliverooOrder } from "./normalize";
import type { DeliverooOrder } from "./schema";

const aed = (v: number) => ({ cents: toMinor(v), currency_code: "AED" as const });

function uuidFromSeq(seq: number): string {
  const hex = (seq * 2654435761).toString(16).padStart(8, "0").slice(-8);
  return `${hex}-5c1e-4a7b-9d2f-${(seq * 97).toString(16).padStart(12, "0").slice(-12)}`;
}

function fabricate(spec: MockOrderSpec): DeliverooOrder {
  const t = specTotals(spec);
  return {
    id: uuidFromSeq(spec.sequence),
    display_id: (4000 + (spec.sequence % 6000)).toString(),
    location_id: spec.externalStoreId,
    placed_at: isoFromSpec(spec),
    fulfillment_type: spec.fulfillment === "pickup" ? "customer_collection" : "deliveroo",
    customer: { first_name: spec.customer.name.split(" ")[0], contact_number: spec.customer.phone },
    items: spec.lines.map((l) => ({
      pos_item_id: l.externalItemId,
      name: l.name,
      quantity: l.quantity,
      unit_price: aed(l.unitPrice),
      modifiers: l.modifiers.map((m) => ({ name: m.name, unit_price: aed(m.price) })),
    })),
    partner_order_subtotal: aed(t.subtotal),
    offer_discount: aed(t.discount),
    delivery_fee: aed(spec.deliveryFee),
    vat: aed(t.tax),
    partner_order_total: aed(t.total),
    cash_due: aed(spec.payment === "cash" ? t.total : 0),
    order_notes: spec.notes ?? null,
  };
}

export function createDeliverooMockAdapter(backend: MockPlatformBackend) {
  return new MockChannelAdapter<DeliverooOrder>(
    {
      channel: "deliveroo",
      fabricate,
      normalize: normalizeDeliverooOrder,
      baseLatencyMs: 240,
      statusMap: {
        accepted: "accepted",
        preparing: "in_kitchen",
        ready: "ready_for_collection",
        picked_up: "collected",
        completed: "completed",
        cancelled: "rejected",
      },
    },
    backend,
  );
}
