# Supabase integration — readiness and blockers

**Status: prepared, NOT VERIFIED.** No dedicated CornerOps One Supabase project exists yet,
and provisioning is not authorized. Everything below has been built and tested against a
local PostgreSQL 17 database that emulates the parts of Supabase the app depends on.
Do not call the application production-ready until the hosted checks at the end of this
document pass.

## What CornerOps One uses from Supabase

| Capability | How it is used |
|---|---|
| PostgreSQL | All persistence, via a server-side `DATABASE_URL` (the `postgres` driver). |
| Supabase Auth | Email + password sign-in/sign-up through `@supabase/ssr` with the **publishable** key (`src/server/auth/supabase-provider.ts`). Sessions are cookie-based and refreshed in `src/proxy.ts`. |
| Row Level Security | Enforced on every user request: the server runs each request as `authenticated` with the user's claims (see `docs/security/rls.md`). |

The browser never talks to Supabase directly and never receives a service-role key.

## Setting up a dedicated project (when authorized)

1. Create a dedicated Supabase project for CornerOps One (never reuse another product's project).
   Prefer a region close to the UAE.
2. **Migrations** — apply `supabase/migrations/*.sql` in order, either with the Supabase CLI
   (`supabase db push`) or `DATABASE_URL=… npm run db:migrate:deploy`.
   Never apply `supabase/local/*` to a hosted project (the runner refuses to).
3. **Auth settings** — enable email provider; keep email confirmation ON for production.
   Invitations are claimed only for confirmed emails.
4. **Environment** (server):
   ```
   APP_ENV=staging|production
   APP_MODE=production            # or demo for a separate demo deployment
   AUTH_PROVIDER=supabase
   DATABASE_URL=<pooler connection string, transaction mode>
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
   ```
5. **Demo deployment only** (`APP_MODE=demo`): create the demo auth user in Supabase Auth
   (dashboard or admin API) with `DEMO_USER_EMAIL`, set `DEMO_USER_PASSWORD`, then enter the
   demo once — the app seeds the Demo Workspace and adds the membership.
   Recommended: run the demo on a **separate Supabase project** from production customers.
6. Run the hosted verification checklist below.

## Connection role requirements (to verify on hosted)

The server connects with `DATABASE_URL` and:

- switches to `authenticated` for user requests (`set local role authenticated`) — the
  connecting role must be a member of `authenticated`;
- uses it directly for system work (demo seed/simulation, migrations, health) — the role
  must have `BYPASSRLS`.

On Supabase the `postgres` role is expected to satisfy both. A dedicated least-privilege
login role (member of `authenticated`, plus a separate role for system jobs) is recommended
before onboarding customers.

## Hosted verification checklist (all currently NOT VERIFIED)

- [ ] Migrations apply cleanly on the hosted project (`npm run db:migrate:deploy`).
- [ ] Supabase advisors (security + performance) report no RLS gaps.
- [ ] `npm test` passes when pointed at a **disposable** branch/project with `TEST_DATABASE_URL`
      (note: the test setup drops and recreates the database — never point it at a shared one).
- [ ] Sign-up, email confirmation, sign-in, sign-out and session refresh work through `@supabase/ssr`.
- [ ] `set local role authenticated` and `request.jwt.claims` behave identically through the pooler.
- [ ] Invitation claim works for a confirmed email.
- [ ] `/api/health` reports `database: ok` and all migrations applied.
- [ ] Demo user provisioning and Demo Workspace entry (demo deployment only).

## Local development (what is verified today)

```bash
npm run db:local:start         # project-local PostgreSQL on 127.0.0.1:54329
npm run db:local:reset         # recreate from migrations (+ local Supabase emulation)
npm run db:seed:demo -- --fixtures
npm test
```

`AUTH_PROVIDER=local` is a development-only stand-in for Supabase Auth: it verifies bcrypt
hashes in the local `auth.users` table and issues a signed cookie. It is refused when
`APP_ENV` is `staging` or `production`.
