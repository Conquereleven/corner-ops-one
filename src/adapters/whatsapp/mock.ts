import { round2 } from "@/lib/rng";
import { MockChannelAdapter, isoFromSpec } from "../shared/mock-adapter";
import type { MockOrderSpec, MockPlatformBackend } from "../types";
import { normalizeWhatsAppOrder } from "./normalize";
import type { WhatsAppOrder } from "./schema";

function fabricate(spec: MockOrderSpec): WhatsAppOrder {
  return {
    messageId: `wamid.HBgM${(9_710_000_000 + spec.sequence * 7919).toString(36).toUpperCase()}`,
    conversationId: `conv_${(spec.sequence * 131).toString(36)}`,
    branch: spec.externalStoreId,
    receivedAt: isoFromSpec(spec),
    customerWaName: spec.customer.name,
    customerWaPhone: spec.customer.phone,
    cart: spec.lines.map((l) => ({
      catalogItemId: l.externalItemId,
      name: l.name,
      qty: l.quantity,
      price: l.unitPrice,
      extras: l.modifiers.map((m) => m.name),
      extrasPrice: round2(l.modifiers.reduce((s, m) => s + m.price, 0)),
    })),
    orderType: spec.fulfillment,
    deliveryCharge: spec.deliveryFee,
    discount: spec.discount,
    paymentPreference: spec.payment === "cash" ? "cash" : "payment_link",
    notes: spec.notes,
  };
}

export function createWhatsAppMockAdapter(backend: MockPlatformBackend) {
  return new MockChannelAdapter<WhatsAppOrder>(
    {
      channel: "whatsapp",
      fabricate,
      normalize: normalizeWhatsAppOrder,
      baseLatencyMs: 90,
      statusMap: {
        accepted: "msg:order_confirmed",
        preparing: "msg:in_kitchen",
        ready: "msg:ready",
        picked_up: "msg:on_the_way",
        completed: "msg:delivered",
        cancelled: "msg:order_cancelled",
      },
    },
    backend,
  );
}
