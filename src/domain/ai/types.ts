import type { OrderChannel } from "../channels/types";
import type { StockStatus } from "../inventory/types";

/**
 * A compact, fully-structured picture of the operation. It is the only input
 * an AI provider receives — deterministic or LLM — so answers are grounded in
 * CornerOps data and can cite it.
 */
export interface OperationsSnapshot {
  generatedAt: string;
  scopeLabel: string;
  today: PeriodMetrics;
  yesterdaySameTime: PeriodMetrics;
  locations: LocationSignal[];
  channels: ChannelSignal[];
  stockRisks: StockRisk[];
  delayedOrders: { orderNumber: string; locationName: string; channel: OrderChannel; minutesInStage: number; targetMinutes: number }[];
  products: { top: ProductSignal[]; bottom: ProductSignal[] };
  concentration: { topMarketplace: OrderChannel | null; shareOfDeliveryPct: number; marketplaceSharePct: number };
  menuGaps: { channel: OrderChannel; missing: string[] }[];
  promotedItems: { name: string; tags: string[]; recipeKeys: string[] }[];
}

export interface PeriodMetrics {
  revenue: number;
  orders: number;
  aov: number;
  avgPrepMinutes: number | null;
  cancellationRate: number;
}

export interface LocationSignal {
  id: string;
  name: string;
  revenueToday: number;
  revenueYesterday: number;
  ordersToday: number;
  prepToday: number | null;
  prepBaseline: number | null;
  activeOrders: number;
  delayedOrders: number;
  kitchenLoadPct: number;
  cancellationRate: number;
}

export interface ChannelSignal {
  channel: OrderChannel;
  name: string;
  status: "connected" | "degraded" | "disconnected";
  statusMessage?: string;
  revenueToday: number;
  revenueYesterday: number;
  ordersToday: number;
  aovToday: number;
  cancellationRateToday: number;
  cancellationRateBaseline: number;
  cancelledToday: number;
  /** Last 7 days economics. */
  marginPct7d: number;
  contribution7d: number;
  contributionPerOrder7d: number;
  grossSales7d: number;
  orders7d: number;
  kind: "marketplace" | "owned";
}

export interface StockRisk {
  key: string;
  ingredient: string;
  locationId: string;
  locationName: string;
  status: StockStatus;
  quantity: number;
  unit: string;
  hoursLeft: number | null;
  /** Hours until this location closes tonight. */
  hoursToClose: number;
  affectedItems: string[];
  /** Another location with surplus that could transfer stock. */
  transferFrom?: { locationName: string; quantity: number };
}

export interface ProductSignal {
  name: string;
  quantity: number;
  revenue: number;
  marginPct: number;
}

export type InsightTone = "positive" | "negative" | "neutral";

export interface Insight {
  id: string;
  text: string;
  tone: InsightTone;
  href?: string;
}

export interface SuggestedAction {
  id: string;
  title: string;
  rationale: string;
  impact: "high" | "medium" | "low";
  cta: { label: string; href: string };
}

export interface OperationsBriefing {
  generatedAt: string;
  headline: string;
  briefing: Insight[];
  opportunities: Insight[];
  risks: Insight[];
  actions: SuggestedAction[];
}

export interface AIAnswer {
  question: string;
  answer: string;
  bullets: string[];
  sources: string[];
  followUps: string[];
  provider: string;
  generatedAt: string;
}

/**
 * Pluggable AI provider. v0.1 ships a deterministic analyst; an LLM provider
 * (e.g. Claude via a server-side API key) can implement the same interface and
 * receive the OperationsSnapshot as grounding context.
 */
export interface OperationsAIProvider {
  id: string;
  label: string;
  kind: "deterministic" | "llm";
  answer(question: string, snapshot: OperationsSnapshot): Promise<AIAnswer>;
}
