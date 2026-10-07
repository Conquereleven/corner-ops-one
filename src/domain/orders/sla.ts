import { MINUTE, toMs } from "@/lib/time";
import type { UnifiedOrder } from "./types";

export type SlaLevel = "normal" | "warning" | "critical";

export interface SlaSettings {
  /** New orders should be accepted within this many minutes. */
  acceptTargetMinutes: number;
  /** Default kitchen target from acceptance to ready. */
  prepTargetMinutes: number;
  /** Ready orders should be collected within this many minutes. */
  pickupTargetMinutes: number;
  /** Fraction of a target at which an order turns to WARNING. */
  warningRatio: number;
}

export const DEFAULT_SLA: SlaSettings = {
  acceptTargetMinutes: 3,
  prepTargetMinutes: 18,
  pickupTargetMinutes: 10,
  warningRatio: 0.75,
};

export interface SlaState {
  level: SlaLevel;
  phase: "acceptance" | "preparation" | "pickup" | "none";
  /** Elapsed time in the current phase. */
  elapsedMs: number;
  targetMs: number;
  /** Elapsed since the order was placed. */
  ageMs: number;
}

export function computeSla(order: UnifiedOrder, now: number, settings: SlaSettings = DEFAULT_SLA): SlaState {
  const placed = toMs(order.placedAt) ?? now;
  const ageMs = Math.max(0, now - placed);
  let phase: SlaState["phase"] = "none";
  let start = placed;
  let targetMin = 0;

  switch (order.status) {
    case "new":
      phase = "acceptance";
      targetMin = settings.acceptTargetMinutes;
      break;
    case "accepted":
    case "preparing":
      phase = "preparation";
      start = toMs(order.acceptedAt) ?? placed;
      targetMin = Math.max(order.estimatedPrepMinutes || 0, settings.prepTargetMinutes);
      break;
    case "ready":
      phase = "pickup";
      start = toMs(order.readyAt) ?? placed;
      targetMin = settings.pickupTargetMinutes;
      break;
    default:
      return { level: "normal", phase: "none", elapsedMs: 0, targetMs: 0, ageMs };
  }

  const elapsedMs = Math.max(0, now - start);
  const targetMs = targetMin * MINUTE;
  const level: SlaLevel =
    elapsedMs >= targetMs ? "critical" : elapsedMs >= targetMs * settings.warningRatio ? "warning" : "normal";
  return { level, phase, elapsedMs, targetMs, ageMs };
}

export function isDelayed(order: UnifiedOrder, now: number, settings?: SlaSettings): boolean {
  return computeSla(order, now, settings).level === "critical";
}

export const SLA_LABEL: Record<SlaLevel, string> = {
  normal: "On track",
  warning: "At risk",
  critical: "Late",
};
