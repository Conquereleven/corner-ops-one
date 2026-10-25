import "server-only";
import { z } from "zod";
import { CHANNEL_CATALOG, ORDER_CHANNELS, orderChannelSchema } from "@/domain/channels/types";
import { appMode } from "../config";
import { requirePermission, type AppContext } from "../context/app-context";
import { getDemoFeed } from "../demo/simulation";
import { resetDemoWorkspace } from "../demo/workspace";
import { ForbiddenError } from "../errors";
import { injectOrder } from "./orders";

export async function getSettings(ctx: AppContext) {
  requirePermission(ctx, "settings.view");
  const [settings, restaurant, connections, events] = await Promise.all([
    ctx.data.settings(),
    ctx.repos.organization.restaurant(),
    ctx.data.connections(),
    ctx.organization.isDemo && appMode() === "demo" ? getDemoFeed(ctx.organization.id) : Promise.resolve([]),
  ]);
  return {
    organization: ctx.organization,
    restaurant,
    settings,
    canManage: ctx.permissions.has("settings.manage"),
    integrations: ORDER_CHANNELS.map((c) => ({
      channel: c,
      name: CHANNEL_CATALOG[c].name,
      kind: CHANNEL_CATALOG[c].kind,
      mode: "mock" as const,
      liveAvailable: false,
      locations: connections.filter((x) => x.channel === c).length,
    })),
    simulation: ctx.organization.isDemo ? { events } : null,
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

export async function updateSettings(ctx: AppContext, patch: z.infer<typeof settingsPatchSchema>) {
  const onlyDemo = !patch.sla && !patch.economics && !!patch.demo;
  // Demo simulation toggles are a presenter control; everything else is organization configuration.
  if (onlyDemo) {
    requirePermission(ctx, "demo.manage");
    if (!ctx.organization.isDemo) throw new ForbiddenError("Simulation settings only apply to the Demo Workspace.");
  } else {
    requirePermission(ctx, "settings.manage");
  }
  const before = await ctx.repos.organization.settings();
  const next = structuredClone(before);
  if (patch.sla) Object.assign(next.sla, patch.sla);
  if (patch.demo) Object.assign(next.demo, patch.demo);
  if (patch.economics) {
    for (const [ch, e] of Object.entries(patch.economics)) Object.assign(next.economics[ch as keyof typeof next.economics], e);
  }
  await ctx.repos.organization.updateSettings(next);
  const sections = Object.keys(patch).filter((k) => patch[k as keyof typeof patch]);
  await ctx.repos.events.append({ type: "settings.updated", aggregateType: "organization", aggregateId: ctx.organization.id, payload: { sections } }, ctx.actor);
  await ctx.repos.audit.record(
    {
      action: "settings.updated",
      entityType: "organization_settings",
      entityId: ctx.organization.id,
      before: Object.fromEntries(sections.map((s) => [s, before[s as keyof typeof before]])),
      after: Object.fromEntries(sections.map((s) => [s, next[s as keyof typeof next]])),
    },
    ctx.actor,
  );
  return next;
}

export const demoActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inject"), channel: orderChannelSchema.optional(), locationId: z.string().optional() }),
  z.object({ action: z.literal("reset"), confirm: z.literal("RESET") }),
]);

export async function runDemoAction(ctx: AppContext, input: z.infer<typeof demoActionSchema>) {
  requirePermission(ctx, "demo.manage");
  if (!ctx.organization.isDemo) throw new ForbiddenError("Only the Demo Workspace can be reset or receive simulated orders.");
  if (input.action === "reset") {
    await resetDemoWorkspace(ctx.actor);
    return { ok: true as const, order: null, message: "Demo Workspace restored to its initial state" };
  }
  const res = await injectOrder(ctx, input);
  return { ok: true as const, order: res.order, message: res.message };
}
