import type {
  ChannelConnection,
  ChannelEconomics,
  ChannelLogEntry,
  OrderChannel,
} from "@/domain/channels/types";
import type { InventoryItem, InventoryMovement } from "@/domain/inventory/types";
import type { AppUser, Customer, Location, Organization, Restaurant } from "@/domain/locations/types";
import type { MenuCategory, MenuChannelMapping, MenuItem } from "@/domain/menu/types";
import type { SlaSettings } from "@/domain/orders/sla";
import type { UnifiedOrder } from "@/domain/orders/types";

export interface DemoSettings {
  enabled: boolean;
  /** Average seconds between simulated incoming orders. */
  orderIntervalSeconds: number;
  /** Let the simulator move untouched orders through the kitchen. */
  autoProgress: boolean;
  /** Occasionally degrade channel connections. */
  channelIncidents: boolean;
}

export interface WorkspaceSettings {
  sla: SlaSettings;
  economics: Record<OrderChannel, ChannelEconomics>;
  demo: DemoSettings;
  aiProvider: "deterministic";
}

export interface SimulationEvent {
  id: string;
  at: string;
  kind: "order_received" | "status_change" | "channel_incident" | "channel_recovered" | "inventory";
  message: string;
}

export interface SimulationState {
  lastTickAt: number;
  nextOrderAt: number;
  nextIncidentAt: number;
  recoveries: { connectionId: string; at: number }[];
  events: SimulationEvent[];
}

/**
 * The CornerOps demo database. Mirrors the Postgres schema in
 * supabase/migrations so a Supabase-backed repository can replace it.
 */
export interface Database {
  organization: Organization;
  restaurant: Restaurant;
  locations: Location[];
  users: AppUser[];
  customers: Customer[];
  orders: UnifiedOrder[];
  ordersById: Map<string, UnifiedOrder>;
  menuCategories: MenuCategory[];
  menuItems: MenuItem[];
  menuMappings: MenuChannelMapping[];
  inventoryItems: InventoryItem[];
  inventoryMovements: InventoryMovement[];
  channelConnections: ChannelConnection[];
  channelLogs: ChannelLogEntry[];
  inboxes: Record<OrderChannel, unknown[]>;
  acknowledgedAlerts: Set<string>;
  alertFirstSeen: Map<string, string>;
  settings: WorkspaceSettings;
  counters: { id: number; orderNumber: number; externalSequence: number };
  simulation: SimulationState;
  seededAt: number;
}
