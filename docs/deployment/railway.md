# Railway deployment readiness

**Status: prepared only.** The Railway project "Corner Ops 1" is an infrastructure placeholder.
Nothing has been deployed; no services, domains or auto-deploys have been created. Deployment
requires a separate founder GO, and a dedicated Supabase project must exist first
(see `docs/supabase.md`).

## Build configuration

`railway.json` (config-as-code):

| Setting | Value |
|---|---|
| Build | `npm ci && npm run build` (Next.js 16, Turbopack) |
| Pre-deploy | **none** — migrations are a separate, gated step (see *Database migrations*) |
| Start | `npm run start` (`next start`, listens on `$PORT`) |
| Health check | `GET /api/health/ready` → `200` only when config is valid, the database is reachable, every migration of this build is applied with a matching checksum and required objects exist; otherwise `503` with the failing check. `GET /api/health/live` → `200` while the process serves (no database). `/api/health` is an alias of `ready`. |
| Restart | on failure, max 5 retries |

Runtime: Node.js ≥ 20.9 (`.nvmrc` pins 22). `tsx` is a runtime dependency because the
migration job runs the TypeScript migrator.

## Database migrations (gated, never implicit)

The migrator holds a **session** advisory lock (concurrent runners wait) and applies each file
in its own transaction together with its ledger row. That requires a **direct** connection
(`db.<ref>.supabase.co:5432`) or the **session-mode** pooler (`…pooler.supabase.com:5432`) —
never the transaction pooler (`:6543`, `pgbouncer=true`), which the migrator refuses.

| Variable | Where | Notes |
|---|---|---|
| `MIGRATION_DATABASE_URL` | migration job / operator shell only, **secret** | direct or session connection; never set on the web service, never read by application code (unit-tested) |
| `MIGRATION_CONFIRM` | migration job only | must equal the latest migration version of the build being applied (`db:migrate:status` prints it) |

Migrations are not run on deploy, because a new schema can be incompatible with the instances
still serving traffic (v0.2.1 is an example: it revokes privileges the v0.2.0 code relied on).
Procedure for every release that contains migrations:

1. **Compatibility review.** Read the pending files (`npm run db:migrate:status`, read-only;
   needs `MIGRATION_DATABASE_URL`). Decide: *expand-only* (old code keeps working) or *breaking*.
2. **Backup.** Take a fresh backup / confirm point-in-time recovery is enabled and note the
   restore point. Do not continue without one.
3. **Breaking changes only:** put the service in maintenance (scale to zero or block traffic)
   before migrating — old instances must not serve against the new schema.
4. **Apply.** `MIGRATION_DATABASE_URL=… MIGRATION_CONFIRM=<latest> npm run db:migrate:deploy`
   from a trusted machine or a one-off job. Concurrent runs serialize; a failing file rolls
   back with its ledger row and stops the run.
5. **Deploy** the matching build. `/api/health/ready` stays `503` until every migration of that
   build is applied with matching checksums, so new instances never take traffic early.
6. **Verify** with `db:migrate:status` (nothing pending or changed) and the staging plan below.

**Recovery is roll-forward.** If a migration fails, nothing from that file is applied: fix it
in a new migration and repeat from step 1. If an applied migration is wrong, ship a corrective
migration. Restore the backup from step 2 only for data loss, accepting the loss of later writes.

## Environment variable inventory

| Variable | Scope | Staging | Production | Notes |
|---|---|---|---|---|
| `APP_ENV` | server | `staging` | `production` | Disables the local auth stand-in; unknown values are a configuration error (readiness fails) |
| `APP_MODE` | server | `production` (or `demo` for a demo service) | `production` | `demo` enables Demo Workspace + simulator |
| `AUTH_PROVIDER` | server | `supabase` | `supabase` | `local` is refused outside development |
| `DATABASE_URL` | server, **secret** | staging Supabase pooler | production Supabase pooler | runtime only (transaction mode is fine: `prepare: false`); never used for migrations; never exposed to the client |
| `DATABASE_POOL_MAX` | server | `10` | tune per instance | request pool; keep (request + system) under the pooler limit |
| `DATABASE_SYSTEM_POOL_MAX` | server | `3` | `3` | separate pool for demo simulator / session bootstrap |
| `NEXT_PUBLIC_SUPABASE_URL` | public | ✓ | ✓ | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | ✓ | ✓ | publishable key only |
| `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD` | server, **secret** | demo service only | — | |
| `DEMO_AUTO_REFRESH` | server | `daily` | — | demo only |
| `SESSION_SECRET` | server, **secret** | — | — | local auth only; not needed with Supabase |

Never set `SUPABASE_SERVICE_ROLE_KEY` on the web service — v0.2 does not need it.

## Deployment strategy

1. **Environments:** `staging` and `production` as separate Railway environments, each with
   its own Supabase project. A public demo, if wanted, is a third service with `APP_MODE=demo`
   on its own database.
2. **Branching:** deploy staging from the integration branch; production only from `main`
   after founder approval. No auto-deploy to production.
3. **Migrations:** forward-only, additive where possible; applied by the gated procedure above,
   never by the deploy itself. Destructive changes ship in two releases (expand → contract)
   whenever possible; otherwise they require the maintenance window in step 3.
4. **Single instance first.** The demo simulator is serialized with Postgres advisory locks, so
   horizontal scaling is safe, but start with one replica and scale after observing load.

## Staging verification plan

1. Deploy to staging; confirm `/api/health/ready` → `200` with `migrations.status = "ok"` and `schema.status = "ok"`.
2. Sign up → confirm email → sign in → create organization → add location → invite a branch
   manager and kitchen staff → accept invitations from separate accounts.
3. Repeat the role checks from `docs/security/rls.md` in the browser (forbidden pages, 403 APIs,
   location-limited "All locations").
4. Restart the service; confirm data persists.
5. Run `npm test` against a **disposable** staging database branch (`TEST_DATABASE_URL`) — the
   suite drops and recreates its database.
6. Review Supabase security/performance advisors.

## Rollback strategy

**Application:** redeploy the previous successful Railway deployment. This is only safe when
the previous build is compatible with the database schema now in place — check the table below.

**Database:** migrations are forward-only and the runner never rolls back. Several applied
migrations are **not reversible without data loss or manual work**:

| Migration | Irreversible / breaking effect |
|---|---|
| `20261025100000_tenancy_and_memberships` | drops the v0.1 `public.users` table; `alerts.acknowledged_by` converted to `uuid` (values nulled) |
| `20261025100200_operational_integrity` | drops `inventory_movements.created_by`; replaces order/connection uniqueness constraints with tenant-scoped ones; `order_items.location_id` / `alerts.alert_key` become NOT NULL |
| `20261026100100_order_and_inventory_operations` | revokes client writes on orders, inventory and audit; a v0.2.0 build (direct writes) **fails** against it |
| `20261026100200_access_hardening` | hides finance-only columns from clients; a v0.2.0 build (`select *`) **fails** against it |
| `20261026100300_demo_isolation` | organizations become update-limited to name/legal name for clients |

Consequences:

- Rolling the **application** back across `20261026100100`–`100300` (v0.2.1 → v0.2.0) is **not
  supported**: the old code depends on privileges the database no longer grants. Roll forward
  with a fix instead.
- Rolling the **database** back means restoring a backup / point-in-time recovery taken **before**
  the migration (step 2 above), accepting the loss of writes made since. Take (or confirm) a
  restorable backup immediately before every production migration.
- Reverting a single migration by hand is not supported; write a corrective forward migration.
- Tags per release (`v0.1.0`, `v0.2.x`) identify the code that matches each schema state.
