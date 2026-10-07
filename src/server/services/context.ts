import "server-only";
import { ALL_LOCATIONS, type LocationScope } from "@/domain/locations/types";
import type { UnifiedOrder } from "@/domain/orders/types";
import { DAY, startOfDubaiDay, toMs } from "@/lib/time";
import { tick } from "../simulation/engine";
import { getRuntime, type Runtime } from "../store/runtime";

/** The signed-in demo user (v0.1 has a single demo identity). */
export const DEMO_USER_ID = "usr_owner";

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Get the runtime with the simulated world advanced to now. */
export async function live(): Promise<Runtime> {
  const rt = getRuntime();
  await tick(rt);
  return rt;
}

export function resolveScope(rt: Runtime, location: string | null | undefined): LocationScope {
  if (!location || location === ALL_LOCATIONS) return ALL_LOCATIONS;
  return rt.db.locations.some((l) => l.id === location) ? location : ALL_LOCATIONS;
}

export function inScope(scope: LocationScope, locationId: string): boolean {
  return scope === ALL_LOCATIONS || scope === locationId;
}

export function ordersBetween(rt: Runtime, scope: LocationScope, start: number, end: number): UnifiedOrder[] {
  return rt.db.orders.filter((o) => {
    if (!inScope(scope, o.locationId)) return false;
    const t = toMs(o.placedAt)!;
    return t >= start && t < end;
  });
}

export function todayWindow(now: number) {
  const start = startOfDubaiDay(now);
  return { start, end: now + 1, yStart: start - DAY, yEnd: now - DAY };
}
