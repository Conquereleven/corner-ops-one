/** Domain events recorded in the transactional outbox (public.domain_events). */
export const DOMAIN_EVENT_TYPES = [
  "order.received",
  "order.accepted",
  "order.preparing",
  "order.ready",
  "order.picked_up",
  "order.completed",
  "order.cancelled",
  "inventory.adjusted",
  "inventory.low",
  "inventory.out_of_stock",
  "inventory.shortfall",
  "inventory.shortfall_resolved",
  "menu.item_updated",
  "menu.publish_requested",
  "menu.availability_changed",
  "channel.connected",
  "channel.disconnected",
  "channel.degraded",
  "location.updated",
  "membership.invited",
  "membership.updated",
  "settings.updated",
  "demo.reset",
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEvent<T = unknown> {
  id: string;
  organizationId: string;
  locationId?: string;
  type: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  payload: T;
  actorUserId?: string;
  actorLabel?: string;
  createdAt: string;
  processedAt?: string;
}

/** Event emitted when an order enters a status. */
export const ORDER_STATUS_EVENT: Record<string, DomainEventType> = {
  new: "order.received",
  accepted: "order.accepted",
  preparing: "order.preparing",
  ready: "order.ready",
  picked_up: "order.picked_up",
  completed: "order.completed",
  cancelled: "order.cancelled",
};
