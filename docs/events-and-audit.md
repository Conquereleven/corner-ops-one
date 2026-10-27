# Event engine and audit log

## Domain events (transactional outbox)

`public.domain_events` is written **in the same transaction** as the change that produced the
event. **Clients cannot insert events.** They come only from validated sources: the database
operations (orders, inventory, shortfalls), trusted server connections (ingestion, simulator,
demo reset — `src/server/repositories/events.ts`), and configuration triggers that derive the
event from the actual row change (`private.emit_config_event`; no change, no event). Every
insert has `processed_at`, `attempts`, `last_error` and `created_at` reset, and the actor pinned
to the signed-in user when one is acting. If the change rolls back, so does the event —
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
| `order.accepted` · `order.preparing` · `order.ready` · `order.picked_up` · `order.completed` · `order.cancelled` | `apply_order_transition()` (database operation used by staff actions and the simulator) |
| `inventory.adjusted` | `record_inventory_movement()` |
| `inventory.low` · `inventory.out_of_stock` | movements, order acceptance or shortfall reconciliation crossing the threshold |
| `inventory.shortfall` · `inventory.shortfall_resolved` | order acceptance with insufficient stock; explicit resolution (see `docs/inventory-shortage-policy.md`) |
| `menu.item_updated` · `menu.availability_changed` · `menu.publish_requested` | triggers on `menu_items` / `menu_channel_mappings` (status → pending) |
| `channel.connected` · `channel.disconnected` · `channel.degraded` | trigger on `channel_connections` status changes (staff actions and simulated incidents) |
| `location.updated` | trigger on `locations` |
| `membership.invited` · `membership.updated` | triggers on `organization_memberships` |
| `settings.updated` | trigger on `organization_settings` (changed sections) |
| `demo.reset` | Demo Workspace reset |

Rows are immutable (trigger, every column) except the outbox processing columns
(`processed_at`, `attempts`, `last_error`), and cannot be deleted except by an organization
cascade or an explicit purge from a trusted server connection. Clients have no UPDATE/DELETE
privilege; they may insert only events attributed to themselves, in their organization and
locations. **No consumer exists yet** — v0.2 only records events reliably. The partial index
`domain_events_unprocessed_idx` is ready for a future worker (webhooks, notifications,
automation, analytics pipelines) that claims rows with `for update skip locked`.

## Audit log

`public.audit_logs` answers *who* (`actor_user_id`, `actor_label`), *what* (`action`,
`entity_type`, `entity_id`), *when* (`created_at`), *where* (`organization_id`, `location_id`),
*from* (`before_data`) and *to* (`after_data`). Metadata passes through `redact()` so keys such
as `password`, `token`, `apiKey`, `credential*` are never stored.

Audit entries are written **by the database**, never by client-supplied SQL (clients have no
INSERT privilege on `audit_logs`):

- **Operations** (`apply_order_transition`, `record_inventory_movement`, `resolve_order_shortfall`,
  `create_organization`) write their own entry in the same transaction.
- **Configuration tables** are audited by row triggers (`private.audit_row_change`) with the
  changed columns only (camelCase before/after, credential references redacted). Changes caused
  by cascades, and seeding while a *server* connection sets `cornerops.audit_suspended`, are not
  audited; a client setting that flag has no effect.

| Action | Source |
|---|---|
| `order.status_changed`, `order.cancelled` | `apply_order_transition` (status + lifecycle timestamps before/after) |
| `inventory.adjusted` | `record_inventory_movement` (quantity before/after, type, note) |
| `inventory.shortfall`, `inventory.shortfall_resolved` | order acceptance; `resolve_order_shortfall` (lines before/after, method, note) |
| `menu.item.created/updated/deleted`, `menu.availability_changed`, `menu.category.*`, `menu.recipe.*` | triggers on menu tables |
| `channel.connection_changed`, `channel.credentials_changed`, `channel.connection.*` | trigger on `channel_connections` (telemetry columns ignored) |
| `membership.invited`, `membership.accepted`, `membership.role_changed`, `membership.disabled`, `membership.enabled`, `membership.removed` | trigger on memberships |
| `membership.location_granted`, `membership.location_changed`, `membership.location_revoked` | trigger on location grants (INSERT/UPDATE/DELETE): complete previous/new grant, membership, user and role; clients cannot UPDATE grants |
| `membership.quarantined` | registration of a shared demo identity disabling a legacy production membership/invitation |
| `organization.created`, `organization.updated`, `settings.updated`, `restaurant.*`, `location.created`, `location.updated` | `create_organization`; triggers |
| `demo.reset` | Demo Workspace reset (server) |

Audit rows are **append-only**: a trigger rejects `UPDATE` and `DELETE` (except cascades when an
organization is deleted, and the explicit Demo Workspace purge from a server connection). Owners
and admins can read the log in **Settings → Activity log**.
