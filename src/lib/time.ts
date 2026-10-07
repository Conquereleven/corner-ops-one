/**
 * Time helpers. All operational reporting is anchored to the restaurant's
 * timezone (Asia/Dubai, UTC+4, no DST), independent of the server's timezone.
 */
export const RESTAURANT_TIMEZONE = "Asia/Dubai";
export const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Epoch ms of 00:00 Dubai time for the day containing `ts`. */
export function startOfDubaiDay(ts: number): number {
  const shifted = ts + DUBAI_OFFSET_MS;
  return shifted - (((shifted % DAY) + DAY) % DAY) - DUBAI_OFFSET_MS;
}

/** Hour of day (0-23) in Dubai time. */
export function dubaiHour(ts: number): number {
  return new Date(ts + DUBAI_OFFSET_MS).getUTCHours();
}

/** ISO date (YYYY-MM-DD) of the Dubai calendar day containing `ts`. */
export function dubaiDateKey(ts: number): string {
  return new Date(ts + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function toMs(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? undefined : v;
}

export function iso(ts: number): string {
  return new Date(ts).toISOString();
}

export function minutesBetween(fromIso?: string, toIso?: string): number | undefined {
  const a = toMs(fromIso);
  const b = toMs(toIso);
  if (a === undefined || b === undefined) return undefined;
  return (b - a) / MINUTE;
}
