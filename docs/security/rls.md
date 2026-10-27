# Database security design — CornerOps One

Authorization is enforced twice, independently:

1. **Application layer** — `AppContext` is resolved server-side from the session
   (`src/server/context`). Services call `requirePermission` / `requireLocationAccess`
   from the central permission model (`src/domain/auth/permissions.ts`). Organization,
   role and location are never taken from client input.
2. **Database layer** — every request runs in a transaction as the Postgres role
   `authenticated` with the user's JWT claims (`withUserTransaction`), so privileges, Row
   Level Security and triggers apply to every statement exactly as they would through
   Supabase PostgREST.

The database layer is designed to hold on its own: a compromised or buggy client that can
issue arbitrary SQL as `authenticated` (which is what the Supabase Data API allows) still
cannot cross tenants or locations, change order state outside the state machine, rewrite
money, edit stock without a movement, read cost data it is not entitled to, or forge or
suppress audit entries. `tests/integration/adversarial-sql.test.ts` exercises this directly.

## Identity model

| Concept | Table | Notes |
|---|---|---|
| Identity | `auth.users` | Owned by Supabase Auth. No passwords in `public`. |
| Profile | `public.profiles` | Display name/email, created by trigger on `auth.users`. |
| Membership | `public.organization_memberships` | `role` ∈ OWNER, ADMIN, OPERATIONS_MANAGER, BRANCH_MANAGER, KITCHEN_STAFF; `status` ∈ invited, active, disabled. |
| Location grants | `public.membership_locations` | Only used by BRANCH_MANAGER and KITCHEN_STAFF. |
| Demo identities | `public.demo_identities` | Shared Demo Workspace sign-ins, registered by the server only. |

Only `status = 'active'` memberships grant access. Disabling a membership revokes access on the next request.

All helpers derive from `private.effective_memberships()`: active memberships of `auth.uid()`,
**excluding a registered demo identity's memberships outside demo organizations** — whatever rows
exist (e.g. left over from a v0.2.0 database).

## Write model (v0.2.1)

Clients (`authenticated`) have **no INSERT/UPDATE/DELETE privilege** on `orders`, `order_items`,
`kitchen_tickets`, `customers`, `inventory_items`, `inventory_movements`,
`order_inventory_shortfalls`, `daily_metrics`, `audit_logs`, `domain_events`, and no UPDATE on
`membership_locations` (grants are inserted or deleted, each audited). Those changes happen only through narrow `SECURITY DEFINER` operations that
re-check role, location and business rules under row locks:

| Operation | Who | What it guarantees |
|---|---|---|
| `apply_order_transition(order, action, …)` | members at the order's location; cancel: OWNER/ADMIN/OPS/BRANCH | SQL state machine (mirrors `src/domain/orders/state-machine.ts`), lifecycle timestamps, history, first-accept recipe consumption, no READY/PICKED UP/COMPLETE while an inventory shortfall is open, event + audit in the same transaction |
| `record_inventory_movement(item, type, qty, note, target)` | OWNER/ADMIN/OPS/BRANCH at the location(s) | validation, deadlock-free locking (id order), never negative, transfer pairs, movement + event + audit |
| `resolve_order_shortfall(order, method, note)` | OWNER/ADMIN/OPS/BRANCH at the location | explicit reconciliation or accepted shortfall (note required), audit before/after |
| `apply_order_inventory_usage(order)` | members at the location | idempotent reprocessing of recipe consumption; refused unless the order is accepted |
| `record_channel_activity(conn, ok)` | verified members at the location | channel telemetry only; identity-less client sessions are refused |
| `create_organization(…)` / `claim_pending_invitations()` | signed-in, non-demo identities | onboarding (records `organization.created`); invitation claim for a confirmed email |
| `financial_*` (see below) / `demo_feed(org, n)` | finance roles / demo members | read-only |

Defence in depth: `BEFORE UPDATE` guard triggers on `orders` (status, timestamps, money,
identity columns) and `inventory_items` (quantity) refuse changes even from privileged
connections unless made by one of the operations above. Their session flags are honoured
only for non-client roles — a client that sets `cornerops.order_transition`,
`cornerops.inventory_write`, `cornerops.audit_suspended` or the purge flags gains nothing.

Every definer function uses `search_path = ''`; `EXECUTE` is revoked from `PUBLIC`/`anon` on
all functions in `public` and `private` (default privileges too) and granted explicitly.
Calls without a user identity are treated as "system" only when the session is not running as
a client role (`private.is_system_caller()`); a client role without a JWT subject is refused.

## Financial and cost data

Column privileges hide finance-only columns from every client role:

| Hidden column | Readable through |
|---|---|
| `orders.platform_fee` | `financial_order_fees(org, order_ids[])` |
| `menu_items.food_cost` | `financial_menu_costs(org)` |
| `inventory_items.unit_cost` | `financial_inventory_costs(org)` |
| `organization_settings.economics` | `financial_economics(org)` |
| `daily_metrics.platform_fees` | — (not used by the app) |
| `channel_connections.credential_reference` | — (never read by the web tier) |

The `financial_*` functions answer only for OWNER, ADMIN and OPERATIONS_MANAGER of that
organization (and only for locations they can access). The application requests them only
when the role has `profitability.view`; other roles receive no food cost, margin, stock
value, commission or commercial terms in pages, APIs or AI answers.

## Helper functions (`private` schema)

| Function | Returns |
|---|---|
| `member_org_ids()` | organizations where `auth.uid()` has an active membership |
| `org_ids_with_role(roles[])` | organizations where the caller holds one of `roles` |
| `accessible_location_ids()` | all locations of orgs where the caller is OWNER/ADMIN/OPS, plus granted locations for restricted roles |
| `can_access_location(id)` | membership test against the above |
| `member_role(org)`, `is_system_caller()`, `actor_uid()`, `can_view_financials(org)` | used inside definer operations only |

They only answer for `auth.uid()`, use `search_path = ''`, and are evaluated once per
statement (`col in (select private.…())`), not per row.

## Read policies by table

| Table | Read |
|---|---|
| organizations | member (client update: `name`, `legal_name` only; `is_demo`/identity are system-controlled) |
| profiles | self + colleagues |
| organization_memberships | own row; OWNER/ADMIN see the team |
| membership_locations | OWNER/ADMIN; own grants |
| restaurants, organization_settings | member (settings without `economics`) |
| locations, orders, order_items, kitchen_tickets, inventory_*, order_inventory_shortfalls, channel_connections, daily_metrics | accessible locations |
| channel_logs, alerts | member + (org-level or accessible location) |
| menu_*, customers | member |
| domain_events | OWNER/ADMIN/OPS |
| audit_logs | OWNER/ADMIN |
| organization_counters, demo_workspace_state, demo_identities | — (system only) |

All tables use `FORCE ROW LEVEL SECURITY`; `anon` has no table privileges and no function
execute privileges. Configuration writes that remain client-side (menu, mappings, channel
connections, locations, settings sections, memberships) are limited by RLS to the roles in
the permission matrix and are audited by database triggers (see `docs/events-and-audit.md`).

## Tenant relationship integrity

Composite foreign keys (`(organization_id, …)` and `(id, location_id)`) make it impossible for a
row to reference a parent in another organization, or an order/item at another location
(migration `20261026100000_tenant_relationship_integrity.sql`), independently of RLS.

## Demo Workspace isolation

- Demo identities cannot hold a membership in, be invited to, or create a non-demo
  organization — enforced by trigger even for server connections. Memberships they already hold
  (legacy data) never count (`effective_memberships`) and are quarantined on registration:
  disabled, recorded in `demo_identity_quarantine` and audited, never deleted. Sessions using
  the configured demo email are registered before their identity is resolved.
- Client roles cannot add, change or remove memberships (or location grants) of a demo
  organization, and cannot change any demo organization.
- `is_demo` can only be set by the server. Demo reset restores other members with their
  previous role and location grants (nobody is promoted).

## System transactions

`withSystemTransaction` (separate small pool) bypasses RLS. It is used only for Demo Workspace
seed/reset/simulation (guarded by `organizations.is_demo` and `APP_MODE=demo`), local-auth
credential checks (development only), migrations and health checks. It is never opened while a
user transaction is held: demo actions are authorized in the user transaction and executed
after it commits.

## Verification

`npm test` runs against a disposable, freshly migrated local Postgres (guarded — see
`tests/support/db-safety.ts`):

- `tenant-isolation`, `location-and-roles` — cross-tenant / cross-location reads and writes.
- `legacy-upgrade` — real v0.2.0 database upgraded through the audited commit and this release.
- `event-and-grant-audit` — event fabrication, processing-state tampering, grant audit, telemetry identity.
- `adversarial-sql` — direct SQL as each role: state machine, money, stock, audit forging and
  suppression, financial columns and functions, tenant FKs, demo isolation, event immutability.
- `inventory-integrity`, `inventory-shortfall` — lifecycle, idempotency, concurrency, shortage policy.
- `order-lifecycle`, `inventory-menu-channels`, `demo-and-team`, `reliability`.

**NOT VERIFIED:** all of the above runs on PostgreSQL 17 with a local emulation of the Supabase
`auth` schema and roles (`supabase/local/`). Nothing has been applied to a hosted Supabase project.
