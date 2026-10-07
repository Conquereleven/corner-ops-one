import { CHANNEL_CATALOG, ORDER_CHANNELS, type ChannelEconomics, type OrderChannel } from "../channels/types";
import type { MenuItem } from "../menu/types";
import type { UnifiedOrder } from "../orders/types";

export interface ChannelProfitability {
  channel: OrderChannel;
  orders: number;
  grossSales: number;
  /** Discounts funded by the restaurant. */
  discounts: number;
  /** Discounts funded by the platform (informational, not a restaurant cost). */
  platformFundedDiscounts: number;
  commission: number;
  /** Payment processing + delivery cost net of delivery fees collected. */
  deliveryAndServiceFees: number;
  foodCost: number;
  contribution: number;
  marginPct: number;
  contributionPerOrder: number;
  aov: number;
}

export type ProfitabilityTotals = Omit<ChannelProfitability, "channel">;

/**
 * Estimated contribution margin per channel:
 *   gross food sales − restaurant-funded discounts − commission
 *   − payment/delivery costs − food cost.
 * Uses the commercial terms configured in Settings; all figures are estimates.
 */
export function computeChannelProfitability(
  orders: UnifiedOrder[],
  economics: Record<OrderChannel, ChannelEconomics>,
  menu: MenuItem[],
): ChannelProfitability[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const rows = new Map<OrderChannel, ChannelProfitability>();
  for (const ch of ORDER_CHANNELS) {
    rows.set(ch, {
      channel: ch,
      orders: 0,
      grossSales: 0,
      discounts: 0,
      platformFundedDiscounts: 0,
      commission: 0,
      deliveryAndServiceFees: 0,
      foodCost: 0,
      contribution: 0,
      marginPct: 0,
      contributionPerOrder: 0,
      aov: 0,
    });
  }
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const e = economics[o.channel];
    const r = rows.get(o.channel)!;
    const restaurantDiscount = o.discount * e.restaurantFundedDiscountShare;
    const net = o.subtotal - o.discount;
    r.orders += 1;
    r.grossSales += o.subtotal;
    r.discounts += restaurantDiscount;
    r.platformFundedDiscounts += o.discount - restaurantDiscount;
    r.commission += o.platformFee !== undefined && CHANNEL_CATALOG[o.channel].kind === "marketplace"
      ? o.platformFee
      : e.commissionRate * net;
    let fees = e.paymentFeeRate * o.total;
    if (CHANNEL_CATALOG[o.channel].kind === "owned" && o.fulfillment === "delivery") {
      fees += e.deliveryCostPerOrder - o.deliveryFee;
    }
    r.deliveryAndServiceFees += fees;
    r.foodCost += o.items.reduce((s, l) => s + (l.menuItemId ? (byId.get(l.menuItemId)?.foodCost ?? 0) : 0) * l.quantity, 0);
  }
  for (const r of rows.values()) {
    r.contribution = r.grossSales - r.discounts - r.commission - r.deliveryAndServiceFees - r.foodCost;
    r.marginPct = r.grossSales ? (r.contribution / r.grossSales) * 100 : 0;
    r.contributionPerOrder = r.orders ? r.contribution / r.orders : 0;
    r.aov = r.orders ? (r.grossSales - r.discounts - r.platformFundedDiscounts) / r.orders : 0;
  }
  return [...rows.values()].filter((r) => r.orders > 0);
}

export function totalProfitability(rows: ChannelProfitability[]): ProfitabilityTotals {
  const t = rows.reduce(
    (acc, r) => {
      acc.orders += r.orders;
      acc.grossSales += r.grossSales;
      acc.discounts += r.discounts;
      acc.platformFundedDiscounts += r.platformFundedDiscounts;
      acc.commission += r.commission;
      acc.deliveryAndServiceFees += r.deliveryAndServiceFees;
      acc.foodCost += r.foodCost;
      acc.contribution += r.contribution;
      return acc;
    },
    { orders: 0, grossSales: 0, discounts: 0, platformFundedDiscounts: 0, commission: 0, deliveryAndServiceFees: 0, foodCost: 0, contribution: 0, marginPct: 0, contributionPerOrder: 0, aov: 0 },
  );
  t.marginPct = t.grossSales ? (t.contribution / t.grossSales) * 100 : 0;
  t.contributionPerOrder = t.orders ? t.contribution / t.orders : 0;
  t.aov = t.orders ? (t.grossSales - t.discounts - t.platformFundedDiscounts) / t.orders : 0;
  return t;
}
