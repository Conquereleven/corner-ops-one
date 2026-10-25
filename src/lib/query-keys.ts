import type { AnalyticsRange } from "@/domain/analytics/range";

/** Query keys are shared with server prefetching (see src/server/prefetch.ts). */
export const queryKeys = {
  overview: (loc: string) => ["overview", loc] as const,
  orders: (loc: string, filters: OrderListParams) => ["orders", loc, filters] as const,
  order: (id: string) => ["order", id] as const,
  kitchen: (loc: string) => ["kitchen", loc] as const,
  menu: (loc: string) => ["menu", loc] as const,
  inventory: (loc: string) => ["inventory", loc] as const,
  channels: (loc: string) => ["channels", loc] as const,
  channelLogs: (ch: string) => ["channel-logs", ch] as const,
  analytics: (loc: string, range: AnalyticsRange) => ["analytics", loc, range] as const,
  profitability: (loc: string, range: AnalyticsRange) => ["profitability", loc, range] as const,
  briefing: (loc: string) => ["briefing", loc] as const,
  locations: () => ["locations"] as const,
  directory: () => ["directory"] as const,
  settings: () => ["settings"] as const,
  team: () => ["team"] as const,
  activity: () => ["activity"] as const,
  status: (loc: string) => ["status", loc] as const,
};

export interface OrderListParams {
  channel?: string;
  status?: string;
  range?: string;
  delayed?: boolean;
  q?: string;
  filterLocation?: string;
}


/** Canonical order-list filters from URL params (shared by server prefetch and client). */
export function parseOrderFilters(get: (key: string) => string | null | undefined): OrderListParams {
  const range = get("range") || "live";
  const f: OrderListParams = { range, status: get("status") || (range === "live" ? "active" : "all") };
  const channel = get("channel");
  if (channel) f.channel = channel;
  if (get("delayed") === "1") f.delayed = true;
  const q = get("q");
  if (q) f.q = q;
  const loc = get("filterLocation");
  if (loc) f.filterLocation = loc;
  return f;
}
