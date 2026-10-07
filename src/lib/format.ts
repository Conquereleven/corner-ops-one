import { RESTAURANT_TIMEZONE } from "./time";

// Explicit locale + options so server and browser render identical strings.
const aedFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const aedPreciseFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const intFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatAED(value: number, opts: { precise?: boolean } = {}): string {
  const f = opts.precise ? aedPreciseFormatter : aedFormatter;
  const sign = value < 0 ? "−" : "";
  return `${sign}AED ${f.format(Math.abs(value))}`;
}

export function formatCompactAED(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}AED ${oneDecimal.format(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}AED ${oneDecimal.format(abs / 1_000)}k`;
  return `${sign}AED ${aedFormatter.format(abs)}`;
}

export function formatNumber(value: number): string {
  return intFormatter.format(value);
}

export function formatDecimal(value: number): string {
  return oneDecimal.format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatDelta(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${oneDecimal.format(value)} min`;
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: RESTAURANT_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: RESTAURANT_TIMEZONE,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: RESTAURANT_TIMEZONE,
  day: "2-digit",
  month: "short",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: RESTAURANT_TIMEZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

export function formatClock(isoOrMs: string | number): string {
  return timeFormatter.format(new Date(isoOrMs));
}
export function formatDateTime(isoOrMs: string | number): string {
  return dateTimeFormatter.format(new Date(isoOrMs));
}
export function formatDay(isoOrMs: string | number): string {
  return dayFormatter.format(new Date(isoOrMs));
}
export function formatWeekday(isoOrMs: string | number): string {
  return weekdayFormatter.format(new Date(isoOrMs));
}

/** "8 min ago" style relative time, relative to `now`. */
export function formatRelative(isoOrMs: string | number, now: number): string {
  const ts = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  const diff = Math.max(0, now - ts);
  const s = Math.floor(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** mm:ss (or h:mm:ss) elapsed timer. */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}
