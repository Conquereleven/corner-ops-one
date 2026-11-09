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

<!-- BEGIN ECOSYSTEM-ROLL-001 AMAE -->
## Local AMAE adoption · CTAI-15 · 2026-11-09

Founder-authorized local documentation adoption for this repository only. Preserve every stricter product, client, security, independent-review and release rule above and in applicable scoped instructions. This adapter changes coordination only; it assigns no product implementation.

Read the corporate policies pinned at `https://github.com/Conquereleven/cornertech-ai/tree/d8275e90e35c90e4c293efd179f89c69a60de75d`: `docs/governance/execution-standard.md`, `docs/governance/world-class-operating-standard.md`, `docs/governance/adaptive-multi-agent-engineering.md`, `docs/decisions/ecosystem-dec-002.md`, `docs/security/permissions.md` and `docs/security/human-in-the-loop.md`. A URL is not loaded policy: record the revision actually read and report inaccessible sources. This corporate merge does not prove adoption or loading in any other repository.

Choose SOLO for bounded reversible work, DUAL for a useful implementation/review interface, or SPECIALIZED for distinct verified capabilities. No mandatory fixed pair. Keep one DRI, exact baseline, scoped path ownership and acceptance in the existing task. Reuse validated evidence within its scope. Independent review remains required wherever local rules or risk require it; self-review is not independent.

Keep PREPARED / EXECUTED / VERIFIED / CLOSED separate; use actual fresh-session evidence before claiming loading. Unknown capability stays UNKNOWN. Do not retrieve another client's instructions, data or memory. Old release approvals do not authorize a new effect. No new providers, paid API use, credentials, production/customer data, infrastructure, external communications, pushes, PRs, merges or deployments are authorized by this adapter. Founder acceptance and separately scoped gates remain controlling.
<!-- END ECOSYSTEM-ROLL-001 AMAE -->
