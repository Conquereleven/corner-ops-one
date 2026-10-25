import "server-only";
import { z } from "zod";
import { CHANNEL_CATALOG, ORDER_CHANNELS, orderChannelSchema } from "@/domain/channels/types";
import { appMode } from "../config";
import { requireLocationAccess, requirePermission, type AppContext } from "../context/app-context";
import { getDemoFeed, injectDemoOrder } from "../demo/simulation";
import { resetDemoWorkspace } from "../demo/workspace";
import { ConflictError, ForbiddenError } from "../errors";

export async function getSettings(ctx: AppContext) {
  requirePermission(ctx, "settings.view");
  const [settings, restaurant, connections, events] = await Promise.all([
    ctx.data.settings(),
    ctx.repos.organization.restaurant(),
    ctx.data.connections(),
    ctx.organization.isDemo && appMode() === "demo" ? getDemoFeed(ctx.organization.id, 25, ctx.db) : Promise.resolve([]),
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
    const economics = next.economics;
    if (!economics) throw new ForbiddenError("Channel economics are limited to owners, admins and operations managers.");
    for (const [ch, e] of Object.entries(patch.economics)) Object.assign(economics[ch as keyof typeof economics], e);
  }
  const sections = (["sla", "economics", "demo"] as const).filter((k) => patch[k]);
  // The audit entry (before/after per section) is written by the database trigger on organization_settings.
  await ctx.repos.organization.updateSettings(next, [...sections]);
  await ctx.repos.events.append({ type: "settings.updated", aggregateType: "organization", aggregateId: ctx.organization.id, payload: { sections } }, ctx.actor);
  return next;
}

export const demoActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inject"), channel: orderChannelSchema.optional(), locationId: z.string().optional() }),
  z.object({ action: z.literal("reset"), confirm: z.literal("RESET") }),
]);

export type DemoAction = z.infer<typeof demoActionSchema>;

export interface AuthorizedDemoAction {
  organizationId: string;
  actor: AppContext["actor"];
  input: DemoAction;
}

/**
 * Step 1 (inside the user's RLS transaction): check role, demo organization
 * and location. Returns what step 2 needs; nothing is changed here.
 */
export function authorizeDemoAction(ctx: AppContext, input: DemoAction): AuthorizedDemoAction {
  requirePermission(ctx, "demo.manage");
  if (!ctx.organization.isDemo) throw new ForbiddenError("Only the Demo Workspace can be reset or receive simulated orders.");
  if (input.action === "inject" && input.locationId) requireLocationAccess(ctx, input.locationId);
  return { organizationId: ctx.organization.id, actor: ctx.actor, input };
}

/**
 * Step 2 (after the user transaction has committed): run the simulator work in
 * its own system transaction — never nested inside a pooled user transaction.
 */
export async function executeDemoAction(auth: AuthorizedDemoAction) {
  const { input } = auth;
  if (input.action === "reset") {
    await resetDemoWorkspace(auth.actor);
    return { ok: true as const, order: null, message: "Demo Workspace restored to its initial state" };
  }
  const res = await injectDemoOrder(auth.organizationId, { channel: input.channel, locationId: input.locationId });
  if (res.unavailable) throw new ConflictError(`${input.channel ?? "That channel"} is not available at that location.`);
  return {
    ok: true as const,
    order: res.order,
    message: res.queued ? "The integration is disconnected — the order is queued on the platform until you reconnect." : null,
  };
}
