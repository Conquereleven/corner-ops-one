@AGENTS.md

# CornerOps One — working notes (CornerTech AI)

- Layers: UI → API routes/pages → services (`src/server/services`) → repositories (`src/server/repositories`) → Postgres. Components never query the DB.
- Every request runs through `withAppContext` (`src/server/context/request.ts`): a transaction as `authenticated` with the user's claims, so RLS applies. Use `withSystemTransaction` only for demo seed/reset/simulation, migrations, health.
- Authorization: `src/domain/auth/permissions.ts` is the only place roles map to permissions. Services call `requirePermission` / `requireLocationAccess`; never trust client-sent org/location/role ids.
- Domain logic stays in `src/domain` (pure). UI consumes `UnifiedOrder`, never channel payloads. Channel work goes through `src/adapters/<channel>`.
- Order status changes only via `transitionOrder` (`src/server/services/order-transitions.ts`). Mutations emit a domain event and an audit entry in the same transaction.
- INSERTs on tables some roles can't read must not use `RETURNING` (RLS SELECT policy applies to returned rows).
- jsonb arrays must be passed with `db.json(...)` (postgres.js sends JS arrays as SQL arrays).
- Migrations: add a new timestamped file in `supabase/migrations`; never edit an applied one (checksums are verified). `supabase/local/` is local-only emulation.
- Hosted Supabase is NOT verified and provisioning is not authorized; no Railway deploys or merges to main without founder GO.
- Checks: `npm run typecheck && npm run lint && npm test && npm run build`.
