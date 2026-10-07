import { z } from "zod";

export const ORDER_CHANNELS = ["talabat", "deliveroo", "noon", "keeta", "direct", "whatsapp"] as const;
export const orderChannelSchema = z.enum(ORDER_CHANNELS);
export type OrderChannel = z.infer<typeof orderChannelSchema>;

export const MARKETPLACE_CHANNELS = ["talabat", "deliveroo", "noon", "keeta"] as const satisfies readonly OrderChannel[];

export type ChannelKind = "marketplace" | "owned";

export type ConnectionStatus = "connected" | "degraded" | "disconnected";

/** Whether a channel is backed by a simulated integration or a real API. */
export type IntegrationMode = "mock" | "live";

export interface ChannelDefinition {
  id: OrderChannel;
  name: string;
  shortName: string;
  kind: ChannelKind;
  /** Default commercial terms used for estimated profitability. Editable in Settings. */
  defaultEconomics: ChannelEconomics;
}

export interface ChannelEconomics {
  /** Platform commission as a fraction of gross food sales. */
  commissionRate: number;
  /** Payment processing fee as a fraction of order total (owned channels). */
  paymentFeeRate: number;
  /** Share of order discounts funded by the restaurant (0-1). */
  restaurantFundedDiscountShare: number;
  /** Delivery cost borne by the restaurant per delivered order (own fleet / 3PL). */
  deliveryCostPerOrder: number;
}

export interface ChannelHealth {
  channel: OrderChannel;
  status: ConnectionStatus;
  latencyMs: number;
  lastSyncAt: string | null;
  errorCount: number;
  message?: string;
}

/** A channel's connection at one location (store-level integration). */
export interface ChannelConnection {
  id: string;
  organizationId: string;
  locationId: string;
  channel: OrderChannel;
  /** External store identifier on the platform (e.g. Talabat vendor code). */
  externalStoreId: string;
  status: ConnectionStatus;
  mode: IntegrationMode;
  latencyMs: number;
  lastSyncAt: string | null;
  errorCount: number;
  message?: string;
  createdAt: string;
  updatedAt: string;
}

export type ChannelLogLevel = "info" | "warning" | "error";

export interface ChannelLogEntry {
  id: string;
  channel: OrderChannel;
  locationId?: string;
  level: ChannelLogLevel;
  message: string;
  at: string;
}

export const CHANNEL_CATALOG: Record<OrderChannel, ChannelDefinition> = {
  talabat: {
    id: "talabat",
    name: "Talabat",
    shortName: "Talabat",
    kind: "marketplace",
    defaultEconomics: { commissionRate: 0.25, paymentFeeRate: 0, restaurantFundedDiscountShare: 0.7, deliveryCostPerOrder: 0 },
  },
  deliveroo: {
    id: "deliveroo",
    name: "Deliveroo",
    shortName: "Deliveroo",
    kind: "marketplace",
    defaultEconomics: { commissionRate: 0.28, paymentFeeRate: 0, restaurantFundedDiscountShare: 0.6, deliveryCostPerOrder: 0 },
  },
  noon: {
    id: "noon",
    name: "Noon Food",
    shortName: "Noon",
    kind: "marketplace",
    defaultEconomics: { commissionRate: 0.2, paymentFeeRate: 0, restaurantFundedDiscountShare: 0.8, deliveryCostPerOrder: 0 },
  },
  keeta: {
    id: "keeta",
    name: "Keeta",
    shortName: "Keeta",
    kind: "marketplace",
    defaultEconomics: { commissionRate: 0.16, paymentFeeRate: 0, restaurantFundedDiscountShare: 0.5, deliveryCostPerOrder: 0 },
  },
  direct: {
    id: "direct",
    name: "Direct Website",
    shortName: "Direct",
    kind: "owned",
    defaultEconomics: { commissionRate: 0, paymentFeeRate: 0.029, restaurantFundedDiscountShare: 1, deliveryCostPerOrder: 14 },
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp",
    shortName: "WhatsApp",
    kind: "owned",
    defaultEconomics: { commissionRate: 0, paymentFeeRate: 0.015, restaurantFundedDiscountShare: 1, deliveryCostPerOrder: 14 },
  },
};

export function channelName(channel: OrderChannel): string {
  return CHANNEL_CATALOG[channel].name;
}
