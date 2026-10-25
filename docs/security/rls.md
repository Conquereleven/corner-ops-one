# Row Level Security design — CornerOps One

Authorization is enforced twice, independently:

1. **Application layer** — `AppContext` is resolved server-side from the session
   (`src/server/context`). Services call `requirePermission` / `requireLocationAccess`
   from the central permission model (`src/domain/auth/permissions.ts`). Organization,
   role and location are never taken from client input.
2. **Database layer** — every request runs in a transaction as the Postgres role
   `authenticated` with the user's JWT claims (`withUserTransaction`), so Row Level
   Security applies to every query exactly as it would through Supabase PostgREST.

If the application layer had a bug, RLS still prevents cross-tenant and cross-location access.

## Identity model

| Concept | Table | Notes |
|---|---|---|
| Identity | `auth.users` | Owned by Supabase Auth. No passwords in `public`. |
| Profile | `public.profiles` | Display name/email, created by trigger on `auth.users`. |
| Membership | `public.organization_memberships` | `role` ∈ OWNER, ADMIN, OPERATIONS_MANAGER, BRANCH_MANAGER, KITCHEN_STAFF; `status` ∈ invited, active, disabled. |
| Location grants | `public.membership_locations` | Only used by BRANCH_MANAGER and KITCHEN_STAFF (the spec's `user_locations`, keyed by membership so invitations can carry grants). |

Only `status = 'active'` memberships grant access. Disabling a membership revokes access on the next request.

## Helper functions (`private` schema, SECURITY DEFINER)

| Function | Returns |
|---|---|
| `private.member_org_ids()` | organizations where `auth.uid()` has an active membership |
| `private.org_ids_with_role(roles[])` | organizations where the caller holds one of `roles` |
| `private.accessible_location_ids()` | all locations of orgs where the caller is OWNER/ADMIN/OPERATIONS_MANAGER, plus granted locations for restricted roles |
| `private.can_access_location(id)` | membership test against the above |

They only ever answer for `auth.uid()`, use `search_path = ''`, and are evaluated once per
statement (`col in (select private.…())`), not per row.

## Policies by table

| Table | Read | Write |
|---|---|---|
| organizations | member | update: OWNER, ADMIN (create via `create_organization()`) |
| profiles | self + colleagues | self |
| organization_memberships | own row; OWNER/ADMIN see team | OWNER/ADMIN; only OWNER may create/modify OWNER rows |
| membership_locations | OWNER/ADMIN; own grants | OWNER/ADMIN |
| restaurants, organization_settings | member | OWNER/ADMIN |
| channels (catalog) | any authenticated | — |
| locations | accessible locations | update: OWNER/ADMIN/OPS; insert: OWNER/ADMIN |
| orders, order_items, kitchen_tickets | accessible locations | orders insert/update: accessible locations (kitchen staff can progress orders) |
| channel_connections | accessible locations | OWNER/ADMIN/OPS on accessible locations |
| channel_logs | member + (org-level or accessible location) | insert: same |
| inventory_items | accessible locations | update: OWNER/ADMIN/OPS/BRANCH on accessible locations |
| inventory_movements | accessible locations | insert: OWNER/ADMIN/OPS/BRANCH, `actor_user_id = auth.uid()` |
| menu_* | member | OWNER/ADMIN/OPS |
| customers | member | insert: member |
| alerts | member + location scope | insert/update: member |
| domain_events | OWNER/ADMIN/OPS | insert: member, `actor_user_id = auth.uid()`, location in scope |
| audit_logs | OWNER/ADMIN | insert: member, `actor_user_id = auth.uid()`; **append-only trigger** blocks update/delete |
| organization_counters, demo_workspace_state | — (system only) | — |

All tables use `FORCE ROW LEVEL SECURITY`; `anon` has no table privileges.

## Security-definer operations

Some side effects must be possible for roles that may not write the underlying table directly.
Each function re-checks the caller's access itself:

- `apply_order_inventory_usage(order_id)` — recipe consumption when an order is accepted
  (kitchen staff can accept; they cannot adjust stock). Idempotent per order.
- `record_channel_activity(connection_id, success)` — channel telemetry (last sync, error count).
- `create_organization(...)` — onboarding; the caller becomes OWNER.
- `claim_pending_invitations()` — activates invitations matching the caller's **confirmed** email.

## System transactions

`withSystemTransaction` bypasses RLS (connection role must have `BYPASSRLS`). It is used only for:
Demo Workspace seed/reset/simulation (guarded by `organizations.is_demo` and `APP_MODE=demo`),
local-auth credential checks (development only), migrations and the health check.

## Verification

`npm test` runs the integration suite against a migrated Postgres:

- `tests/integration/tenant-isolation.test.ts` — Org A ↔ Org B visibility across 13 tables, no-membership user sees nothing, `anon` denied, cross-tenant writes refused, search scoped.
- `tests/integration/location-and-roles.test.ts` — Branch Manager limited to assigned branches (RLS and service), strict 403 on unauthorized location, kitchen staff cannot change settings (service **and** RLS), cannot see profitability/analytics/audit, can progress but not cancel.
- `tests/integration/order-lifecycle.test.ts` — atomicity, append-only audit.
- `tests/integration/demo-and-team.test.ts` — demo isolation, OWNER-grant rules, invitation claim, disable revokes access.

**NOT VERIFIED:** policies have been tested on PostgreSQL 17 with a local emulation of the
Supabase `auth` schema (`supabase/local/`). They have not yet been applied to a hosted
CornerOps One Supabase project.
