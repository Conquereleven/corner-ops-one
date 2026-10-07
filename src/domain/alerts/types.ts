import type { OrderChannel } from "../channels/types";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertCategory = "inventory" | "kitchen" | "channel" | "orders" | "menu";

export interface OperationalAlert {
  /** Stable id derived from the condition, so acknowledgements persist across recomputation. */
  id: string;
  organizationId: string;
  locationId?: string;
  channel?: OrderChannel;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  href: string;
  createdAt: string;
}

export const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
