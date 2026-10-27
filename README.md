# CornerOps One

> One operation. Every channel.

**CornerOps One** is the unified operating layer for multi-channel restaurant operations. It
sits above the delivery platforms (Talabat, Deliveroo, Noon Food, Keeta) and owned channels
(website, WhatsApp): one normalized order model, one kitchen board, one inventory and one view
of what every channel earns.

CornerOps One is a product of **CornerTech AI**. Proprietary and confidential — all rights reserved.

| | |
|---|---|
| Version | **0.2.1 — Security & Data Integrity Remediation** |
| Status | Persistence, auth, multi-tenancy, roles, events and audit implemented and tested on local PostgreSQL, with database-enforced business rules. **Hosted Supabase integration is prepared but NOT VERIFIED** — see [docs/supabase.md](docs/supabase.md). Not production-ready. |

---

## Governance and engineering acceptance

CornerOps One follows [Execution Standard 1.0](docs/governance/execution-standard.md) for accountability, evidence and closure, and [CT-WCOS v1.0](docs/governance/world-class-operating-standard.md) for design, engineering, product and AI quality **once the adoption PR has passed independent review and received separate Founder merge approval**. Prior to that, these files are a governance proposal, not an adopted production policy. Local v0.2.1 security acceptance is **GO WITH CONDITIONS**; hosted staging remains **NO-GO**.

## Quick start (local)

Requirements: Node ≥ 20.9 and PostgreSQL 17 binaries on `PATH` (`initdb`, `pg_ctl`, `psql`). No Docker needed.

```bash
npm install
cp .env.example .env.local            # set SESSION_SECRET and LOCAL_FIXTURE_PASSWORD
npm run db:local:start                # project-local Postgres on 127.0.0.1:54329 (data in .local/)
npm run db:local:reset                # create the database from migrations
npm run db:seed:demo -- --fixtures    # Demo Workspace + a production-like fixture tenant
npm run dev                           # http://localhost:3000
```

- **Enter Demo Workspace** on the sign-in page opens the Casa Norte demo (simulated, isolated).
- Fixture users (local only, password = `LOCAL_FIXTURE_PASSWORD`): `owner@`, `admin@`, `ops@`,
  `branch@` (Dubai Marina + JVC), `kitchen@` (Dubai Marina) — all `@casanorte.test`, in the
  organization *Casa Norte Hospitality LLC*.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development, production build, production server |
| `npm run typecheck` · `npm run lint` | Type check (with route typegen) · ESLint |
| `npm test` | Unit + integration tests (Vitest) against a freshly migrated local Postgres |
| `npm run db:local:start` · `db:local:stop` · `db:local:reset` | Manage the project-local Postgres |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` (from `.env.local`) |
| `npm run db:migrate:status` | Read-only migration plan (pending / changed) for `MIGRATION_DATABASE_URL` |
| `npm run db:migrate:deploy` | Gated hosted migration (`MIGRATION_DATABASE_URL` + `MIGRATION_CONFIRM`; never run on deploy) — see [docs/deployment/railway.md](docs/deployment/railway.md) |
| `npm run db:seed:demo [-- --fixtures]` | Seed the Demo Workspace (and local fixture tenant) |
| `npm run db:verify` | Run the database integration suite |

---

## Architecture

```
Channels (Talabat · Deliveroo · Noon · Keeta · Website · WhatsApp)
   ↓  adapters (src/adapters/*: schema → normalize → mock)       — no platform schema leaks past here
UnifiedOrder (src/domain)                                         — pure domain logic
   ↓
Services (src/server/services)  ← AppContext (user, organization, membership, permissions, locations)
   ↓
Repositories (src/server/repositories)        Event engine → domain_events (outbox)   Audit → audit_logs
   ↓
PostgreSQL (Supabase) with Row Level Security
```

- **UI → API routes → services → repositories → Postgres.** Components never touch the database.
- **AppContext** is derived server-side from the session (`src/server/context`), never from
  client-supplied organization/location/role ids.
- **Every request is a transaction as the `authenticated` role** with the user's claims, so
  RLS applies to all reads and writes. Privileged "system" transactions are limited to the
  demo simulator/seed, migrations and the health check.
- **Order status changes go through one database operation** (`apply_order_transition`, called
  by `transitionOrder`): lock order → state machine → inventory usage (once, shortage-safe) →
  event → audit, atomically. Stock changes go through `record_inventory_movement`. Clients cannot
  write orders, inventory or audit rows directly.
- **Finance-only data** (commission, food cost, unit cost, commercial terms) is hidden from
  roles without profitability access at the database (column privileges + finance functions).
- **Ingestion is idempotent** on `(organization_id, channel_id, external_order_id)`.
- The **kitchen board** reads the same order rows; `kitchen_tickets` is kept in sync by trigger.

```
src/
  domain/            pure logic: orders, auth/permissions, analytics, inventory, alerts, AI, events
  adapters/          channel adapters (mock today; live adapters implement the same interface)
  server/
    context/         AppContext resolution, scope, request wrapper
    repositories/    Postgres repositories (orders, menu, inventory, channels, organizations,
                     locations, memberships, customers, alerts, events, audit)
    services/        use cases (orders, kitchen, menu, inventory, channels, analytics, AI, team…)
    demo/            Demo Workspace: seed, reset, persisted simulator, mock platform backend
    auth/            auth providers (Supabase Auth; local development stand-in)
    db/              connection pool, user/system transactions
  app/               Next.js routes: (app) workspace, (display) KDS, api/*, login, signup, onboarding
supabase/
  migrations/        versioned SQL migrations (apply in order)
  local/             LOCAL ONLY: emulation of Supabase roles + auth schema for dev/tests
tests/               unit/ and integration/ (Vitest)
docs/                RLS, Supabase, events & audit, credentials, Railway
```

## Environments and modes

| Variable | Values | Effect |
|---|---|---|
| `APP_MODE` | `demo` · `production` | `production` disables the Demo Workspace entry, the simulator and access to demo organizations |
| `APP_ENV` | `development` · `test` · `staging` · `production` | `staging`/`production` refuse the local auth stand-in; any other value is a configuration error |
| `AUTH_PROVIDER` | `supabase` · `local` | Supabase Auth, or the local development stand-in |

Full inventory: [.env.example](.env.example) and [docs/deployment/railway.md](docs/deployment/railway.md).

## Authentication

- **Supabase Auth** owns identity (`auth.users`); CornerOps One owns membership and
  authorization. Email + password is implemented; magic link / Google / Microsoft can be added
  behind the same `AuthProvider` interface.
- **Local development** uses `AUTH_PROVIDER=local`: bcrypt hashes in the local `auth.users`
  table and a signed cookie. Never used in staging/production.
- Expired, revoked or deleted sessions are cleared and sent back to sign-in.
- New users without an organization go to **onboarding** and become its OWNER.

## Roles

| Role | Scope | Can |
|---|---|---|
| OWNER | all locations | everything, including granting/transferring OWNER |
| ADMIN | all locations | everything except OWNER grants |
| OPERATIONS_MANAGER | all locations | operations, menu, channels, analytics, profitability, location details; not org settings/team |
| BRANCH_MANAGER | assigned locations | operations, inventory, analytics for their branches; no profitability/settings/team |
| KITCHEN_STAFF | assigned locations | Kitchen + order progress (accept → ready → picked up); no cancellations, analytics, settings |

The matrix lives in `src/domain/auth/permissions.ts`; UI hides what a role can't do, the server
enforces it, and RLS enforces it again. "All locations" means *all locations you can access*.

## Row Level Security

Membership-based policies on every tenant table, location-scoped where relevant, append-only
database-written audit log, column-level privileges for finance data, tenant-aware foreign keys,
no `anon` access. Design and verification: **[docs/security/rls.md](docs/security/rls.md)**;
Supabase Data API exposure: **[docs/security/data-api.md](docs/security/data-api.md)**.

## Inventory shortages

Accepting an order deducts only the stock on hand, records the unmet quantity, raises a critical
alert and blocks READY until a manager resolves it (reconcile from stock, or accept with a note).
Policy: **[docs/inventory-shortage-policy.md](docs/inventory-shortage-policy.md)**.

## Demo Workspace vs production

- The demo organization (`is_demo = true`, *CornerOps Demo / Casa Norte Mexican Kitchen*) is the
  only organization the simulator ever touches. It shows a **DEMO** badge; production
  organizations never do.
- **Enter Demo Workspace** signs in as a shared demo user whose only membership is the demo
  organization (ADMIN there; team and organization management disabled). No customer account is created.
- **Reset Demo Workspace** (Settings → Demo mode, confirmation required) restores the seeded
  state. With `DEMO_AUTO_REFRESH=daily` the demo is regenerated on the first entry of a new day.
- Production data is never reset implicitly.

## Event engine and audit logs

Major mutations write a domain event (outbox) and an audit entry in the same transaction.
Details: **[docs/events-and-audit.md](docs/events-and-audit.md)**.

## Testing

```bash
npm test
```

The suite recreates a **disposable** `cornerops_test` database from migrations (it refuses any
other target — see `tests/support/db-safety.ts`), seeds the Demo Workspace plus a second tenant,
and covers tenant isolation, location access, role restrictions, adversarial SQL as each role,
order lifecycle persistence, idempotency and concurrency, the shortage policy, financial
privacy, event/audit atomicity and immutability, demo isolation/reset, migrations, readiness
and configuration guards. Current result: **50 unit + 98 integration tests passing**. The destructive suite also requires the target server to carry the `cornerops_disposable_cluster` ownership marker (created automatically by `scripts/db/local.sh`).

## What remains simulated

- **All six channel integrations** (mock adapters, no partner APIs, no credentials).
  Live integrations need official partner access; see [docs/integrations/credentials.md](docs/integrations/credentials.md).
- Marketplace **menu publishing** and **availability pushes**.
- **Demo traffic** and channel incidents (demo organization only).
- **AI Operations** uses a deterministic analyst (no LLM). Its data comes from the persisted operations layer.
- **Profitability** is an estimate from configurable commercial terms, not live platform fees.

## Known limitations

- Hosted Supabase (Auth, pooler behaviour, RLS on hosted roles) is **not verified**.
- Invitation **emails are not sent**; invitations are claimed when the invitee signs in with the same confirmed email.
- The event outbox has **no consumer** yet.
- `daily_metrics` is not maintained; analytics query orders directly (fine at current scale).
- Analytics/overview recompute from order rows on every poll; caching will be needed at higher volume.
- Mock channel write-backs run inside the request transaction; live adapters should dispatch from the outbox.

## License and ownership

Copyright © CornerTech AI. All rights reserved. This repository is temporarily public under a Founder-approved exception through
2026-10-31, with return to private planned for 2026-11-01. Visibility does not grant
any license to use, copy or distribute this proprietary software.
