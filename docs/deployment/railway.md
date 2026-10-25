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
| Pre-deploy | `npm run db:migrate:deploy` — applies pending `supabase/migrations` (idempotent, checksum-verified) |
| Start | `npm run start` (`next start`, listens on `$PORT`) |
| Health check | `GET /api/health` → `200` when the database is reachable and config is valid; reports migration count |
| Restart | on failure, max 5 retries |

Runtime: Node.js ≥ 20.9 (`.nvmrc` pins 22). `tsx` is a runtime dependency because the
pre-deploy migration runs the TypeScript migrator.

> To verify on first staging deploy: Railway's current builder picks up `railway.json`
> `preDeployCommand` as expected; if not, run migrations as a one-off command before deploy.

## Environment variable inventory

| Variable | Scope | Staging | Production | Notes |
|---|---|---|---|---|
| `APP_ENV` | server | `staging` | `production` | Disables the local auth stand-in |
| `APP_MODE` | server | `production` (or `demo` for a demo service) | `production` | `demo` enables Demo Workspace + simulator |
| `AUTH_PROVIDER` | server | `supabase` | `supabase` | `local` is refused outside development |
| `DATABASE_URL` | server, **secret** | staging Supabase pooler | production Supabase pooler | transaction mode; never exposed to the client |
| `DATABASE_POOL_MAX` | server | `10` | tune per instance | keep under the pooler limit |
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
3. **Migrations:** forward-only, additive where possible; applied by the pre-deploy step before
   the new version receives traffic. Destructive changes ship in two releases (expand → contract).
4. **Single instance first.** The demo simulator is serialized with Postgres advisory locks, so
   horizontal scaling is safe, but start with one replica and scale after observing load.

## Staging verification plan

1. Deploy to staging; confirm `/api/health` → `{"status":"ok","database":"ok"}` with all migrations applied.
2. Sign up → confirm email → sign in → create organization → add location → invite a branch
   manager and kitchen staff → accept invitations from separate accounts.
3. Repeat the role checks from `docs/security/rls.md` in the browser (forbidden pages, 403 APIs,
   location-limited "All locations").
4. Restart the service; confirm data persists.
5. Run `npm test` against a **disposable** staging database branch (`TEST_DATABASE_URL`) — the
   suite drops and recreates its database.
6. Review Supabase security/performance advisors.

## Rollback strategy

- **Application:** redeploy the previous successful Railway deployment (instant rollback).
- **Database:** migrations are forward-only. Because releases are additive, the previous
  application version keeps working against the newer schema. For a bad migration, ship a
  corrective migration; restore from Supabase point-in-time recovery only for data loss.
- Keep at least one known-good tag per release (`v0.1.0`, `v0.2.x`) to redeploy from.
