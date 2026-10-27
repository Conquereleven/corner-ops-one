@AGENTS.md

## CornerTech operating standards (effective only after an independently reviewed, Founder-approved merge)

Follow [Execution Standard 1.0](docs/governance/execution-standard.md) as the canonical delivery/closure policy and [CT-WCOS v1.0](docs/governance/world-class-operating-standard.md) as the cross-functional quality bar. Preserve all stronger project-specific security and release constraints below.

Claude Chat is the **advisory Virtual CTO**, not Claude Code. Claude Code and Codex are equal-status engineering peers; either may implement or independently review, but never self-approve an implementation. Each material task needs one DRI, an exact scope and SHA, positive/negative tests, independent findings when required, risks and Founder approval at gated actions. Track PREPARED / EXECUTED / VERIFIED / CLOSED / BLOCKED truthfully; local tests do not prove hosted acceptance. Do not merge, deploy, provision, spend or touch customer data without their own authorization.

# CornerOps One — working notes (CornerTech AI)

- Layers: UI → API routes/pages → services (`src/server/services`) → repositories (`src/server/repositories`) → Postgres. Components never query the DB.
- Every request runs through `withAppContext` (`src/server/context/request.ts`): a transaction as `authenticated` with the user's claims, so RLS applies. Use `withSystemTransaction` only for demo seed/reset/simulation, migrations, health.
- Authorization: `src/domain/auth/permissions.ts` is the only place roles map to permissions. Services call `requirePermission` / `requireLocationAccess`; never trust client-sent org/location/role ids.
- Domain logic stays in `src/domain` (pure). UI consumes `UnifiedOrder`, never channel payloads. Channel work goes through `src/adapters/<channel>`.
- Order status changes only via `transitionOrder` → DB `apply_order_transition`; stock only via `record_inventory_movement`; shortfalls via `resolve_order_shortfall`. Clients have no direct writes on orders/inventory/audit. Mutations emit a domain event; audit is written by the DB (operations + triggers), not by app code.
- Finance-only columns (`orders.platform_fee`, `menu_items.food_cost`, `inventory_items.unit_cost`, `organization_settings.economics`, `channel_connections.credential_reference`) are not readable by clients: never `select *` on those tables; use the `financial_*` functions via `createRepositories(..., { financials })`.
- Never open a system transaction while holding a user transaction (authorize in the user tx, execute after commit).
- INSERTs on tables some roles can't read must not use `RETURNING` (RLS SELECT policy applies to returned rows).
- jsonb arrays must be passed with `db.json(...)` (postgres.js sends JS arrays as SQL arrays).
- Migrations: add a new timestamped file in `supabase/migrations`; never edit an applied one (checksums are verified). `supabase/local/` is local-only emulation.
- Hosted Supabase is NOT verified and provisioning is not authorized; no Railway deploys or merges to main without founder GO.
- Checks: `npm run typecheck && npm run lint && npm test && npm run build`.
