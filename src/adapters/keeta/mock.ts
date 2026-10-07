import { specTotals } from "../shared/build-order";
import { MockChannelAdapter } from "../shared/mock-adapter";
import { toMinor } from "../shared/money";
import type { MockOrderSpec, MockPlatformBackend } from "../types";
import { normalizeKeetaOrder } from "./normalize";
import type { KeetaOrder } from "./schema";

function fabricate(spec: MockOrderSpec): KeetaOrder {
  const t = specTotals(spec);
  const orderId = 7_300_000_000 + spec.sequence * 101;
  return {
    orderId,
    orderViewId: `KT${orderId.toString().slice(-8)}`,
    shopId: Number(spec.externalStoreId),
    ctime: Math.floor(spec.placedAt / 1000),
    deliveryType: spec.fulfillment === "pickup" ? 2 : 1,
    recipient: { name: spec.customer.name.split(" ")[0], phoneTail: spec.customer.phone.slice(-4) },
    products: spec.lines.map((l) => ({
      spuId: l.externalItemId,
      name: l.name,
      count: l.quantity,
      price: toMinor(l.unitPrice),
      attrs: l.modifiers.map((m) => ({ name: m.name, price: toMinor(m.price) })),
    })),
    fee: {
      productAmount: toMinor(t.subtotal),
      discountAmount: toMinor(t.discount),
      shippingFee: toMinor(spec.deliveryFee),
      vatAmount: toMinor(t.tax),
      payAmount: toMinor(t.total),
    },
    payType: spec.payment === "cash" ? 2 : 1,
    remark: spec.notes ?? "",
  };
}

export function createKeetaMockAdapter(backend: MockPlatformBackend) {
  return new MockChannelAdapter<KeetaOrder>(
    {
      channel: "keeta",
      fabricate,
      normalize: normalizeKeetaOrder,
      baseLatencyMs: 420,
      statusMap: {
        accepted: "MERCHANT_CONFIRMED",
        preparing: "MERCHANT_PREPARING",
        ready: "MEAL_READY",
        picked_up: "RIDER_PICKED_UP",
        completed: "FINISHED",
        cancelled: "MERCHANT_CANCELLED",
      },
    },
    backend,
  );
}
