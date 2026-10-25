# Event engine and audit log

## Domain events (transactional outbox)

`public.domain_events` is written **in the same transaction** as the change that produced the
event (see `src/server/repositories/events.ts`). If the change rolls back, so does the event —
verified by `tests/integration/order-lifecycle.test.ts › event and audit atomicity`.

```ts
interface DomainEvent<T> {
  id; organizationId; locationId?; type; aggregateType; aggregateId;
  payload: T; actorUserId?; actorLabel?; createdAt; processedAt?
}
```

| Event | Emitted by |
|---|---|
| `order.received` | channel ingestion (simulator/adapters) |
| `order.accepted` · `order.preparing` · `order.ready` · `order.picked_up` · `order.completed` · `order.cancelled` | `transitionOrder()` (staff and simulator) |
| `inventory.adjusted` | stock movements |
| `inventory.low` · `inventory.out_of_stock` | movements or order acceptance crossing the threshold |
| `menu.item_updated` · `menu.availability_changed` | menu edits |
| `channel.connected` · `channel.disconnected` · `channel.degraded` | connection actions, simulated incidents |
| `location.updated` | location edits/creation |
| `membership.invited` · `membership.updated` | team management |
| `settings.updated` | organization settings |
| `demo.reset` | Demo Workspace reset |

Rows are immutable (trigger) except the outbox processing columns (`processed_at`, `attempts`,
`last_error`). **No consumer exists yet** — v0.2 only records events reliably. The partial index
`domain_events_unprocessed_idx` is ready for a future worker (webhooks, notifications,
automation, analytics pipelines) that claims rows with `for update skip locked`.

## Audit log

`public.audit_logs` answers *who* (`actor_user_id`, `actor_label`), *what* (`action`,
`entity_type`, `entity_id`), *when* (`created_at`), *where* (`organization_id`, `location_id`),
*from* (`before_data`) and *to* (`after_data`). Metadata passes through `redact()` so keys such
as `password`, `token`, `apiKey`, `credential*` are never stored.

Audited actions:

| Action | Source |
|---|---|
| `order.status_changed`, `order.cancelled` | order transitions (status + lifecycle timestamps before/after) |
| `inventory.adjusted` | stock movements (quantity before/after, type, note) |
| `menu.item_updated`, `menu.availability_changed`, `menu.publish_requested` | menu |
| `channel.connection_changed` | connect/disconnect/reconnect |
| `membership.invited`, `membership.role_changed`, `membership.locations_changed`, `membership.disabled`, `membership.enabled` | team |
| `organization.created`, `organization.updated`, `settings.updated`, `location.created`, `location.updated` | organization |
| `demo.reset` | Demo Workspace |

Audit rows are **append-only**: a trigger rejects `UPDATE` and `DELETE` (except cascades when an
organization is deleted, and the explicit Demo Workspace purge). Owners and admins can read the
log in **Settings → Activity log**.
