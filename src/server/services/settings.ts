import "server-only";
import { z } from "zod";
import { CHANNEL_CATALOG, ORDER_CHANNELS, orderChannelSchema } from "@/domain/channels/types";
import { resetRuntime } from "../store/runtime";
import { live } from "./context";
import { injectDemoOrder } from "./orders";

export async function getSettings() {
  const rt = await live();
  const { db } = rt;
  return {
    organization: db.organization,
    restaurant: db.restaurant,
    users: db.users,
    settings: db.settings,
    integrations: ORDER_CHANNELS.map((c) => ({
      channel: c,
      name: CHANNEL_CATALOG[c].name,
      kind: CHANNEL_CATALOG[c].kind,
      mode: "mock" as const,
      liveAvailable: false,
      locations: db.channelConnections.filter((x) => x.channel === c).length,
    })),
    simulation: {
      lastTickAt: new Date(db.simulation.lastTickAt).toISOString(),
      events: db.simulation.events.slice(-25).reverse(),
      seededAt: new Date(db.seededAt).toISOString(),
      orderCount: db.orders.length,
    },
  };
}
export type SettingsData = Awaited<ReturnType<typeof getSettings>>;

const economicsSchema = z.object({
  commissionRate: z.number().min(0).max(0.6),
  paymentFeeRate: z.number().min(0).max(0.1),
  restaurantFundedDiscountShare: z.number().min(0).max(1),
  deliveryCostPerOrder: z.number().min(0).max(100),
});

export const settingsPatchSchema = z.object({
  sla: z
    .object({
      acceptTargetMinutes: z.number().min(1).max(30),
      prepTargetMinutes: z.number().min(5).max(90),
      pickupTargetMinutes: z.number().min(2).max(60),
      warningRatio: z.number().min(0.3).max(0.95),
    })
    .partial()
    .optional(),
  demo: z
    .object({
      enabled: z.boolean(),
      orderIntervalSeconds: z.number().int().min(10).max(600),
      autoProgress: z.boolean(),
      channelIncidents: z.boolean(),
    })
    .partial()
    .optional(),
  economics: z.record(orderChannelSchema, economicsSchema.partial()).optional(),
});

export async function updateSettings(patch: z.infer<typeof settingsPatchSchema>) {
  const rt = await live();
  const s = rt.db.settings;
  if (patch.sla) Object.assign(s.sla, patch.sla);
  if (patch.demo) {
    const wasEnabled = s.demo.enabled;
    Object.assign(s.demo, patch.demo);
    if (!wasEnabled && s.demo.enabled) rt.db.simulation.nextOrderAt = Date.now() + 8000;
  }
  if (patch.economics) {
    for (const [ch, e] of Object.entries(patch.economics)) Object.assign(s.economics[ch as keyof typeof s.economics], e);
  }
  return s;
}

export const demoActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inject"), channel: orderChannelSchema.optional(), locationId: z.string().optional() }),
  z.object({ action: z.literal("reset") }),
]);

export async function runDemoAction(input: z.infer<typeof demoActionSchema>) {
  if (input.action === "reset") {
    resetRuntime();
    return { ok: true as const, order: null, message: "Demo data regenerated" };
  }
  const res = await injectDemoOrder(input.channel, input.locationId);
  return { ok: true as const, order: res.order, message: res.message };
}
