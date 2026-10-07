import { z } from "zod";
import { DAY, startOfDubaiDay } from "@/lib/time";

export const ANALYTICS_RANGES = ["today", "yesterday", "7d", "30d"] as const;
export const analyticsRangeSchema = z.enum(ANALYTICS_RANGES);
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

export interface ResolvedRange {
  range: AnalyticsRange;
  start: number;
  end: number;
  /** Comparable previous window (null when there is not enough history). */
  prevStart: number | null;
  prevEnd: number | null;
  label: string;
  comparisonLabel: string;
  bucket: "hour" | "day";
}

export function resolveRange(range: AnalyticsRange, now: number, historyStart: number): ResolvedRange {
  const today = startOfDubaiDay(now);
  switch (range) {
    case "today":
      return { range, start: today, end: now, prevStart: today - DAY, prevEnd: now - DAY, label: "Today", comparisonLabel: "vs same time yesterday", bucket: "hour" };
    case "yesterday":
      return { range, start: today - DAY, end: today, prevStart: today - 2 * DAY, prevEnd: today - DAY, label: "Yesterday", comparisonLabel: "vs day before", bucket: "hour" };
    case "7d": {
      const start = today - 6 * DAY;
      return { range, start, end: now, prevStart: start - 7 * DAY, prevEnd: now - 7 * DAY, label: "Last 7 days", comparisonLabel: "vs previous 7 days", bucket: "day" };
    }
    case "30d": {
      const start = today - 29 * DAY;
      const prevStart = start - 30 * DAY;
      const hasPrev = prevStart >= historyStart;
      return { range, start, end: now, prevStart: hasPrev ? prevStart : null, prevEnd: hasPrev ? now - 30 * DAY : null, label: "Last 30 days", comparisonLabel: hasPrev ? "vs previous 30 days" : "no prior period", bucket: "day" };
    }
  }
}
