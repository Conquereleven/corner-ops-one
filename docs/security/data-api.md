# Supabase Data API exposure

**Status: NOT VERIFIED on a hosted project.** This documents what a hosted CornerOps One
Supabase project would expose and the settings it needs. No hosted project has been created.

## How CornerOps One uses the database

The web app talks to Postgres **directly** (`DATABASE_URL`, server-side only) and switches to the
`authenticated` role with the user's JWT claims for every request. It does **not** need the
Supabase Data API (PostgREST/GraphQL) for data access; the browser uses Supabase only for Auth
(publishable key).

## What the Data API would expose if enabled

Supabase's Data API serves the `public` schema to anyone holding the publishable key plus,
for `authenticated`, a user session. Because the database is designed for exactly that threat
(arbitrary SQL-equivalent requests as `authenticated`), exposure is limited to what each role
may do anyway:

| Surface | `anon` | `authenticated` |
|---|---|---|
| Tables in `public` | no privileges | RLS-filtered reads; finance-only columns hidden by column privileges; no writes to orders, items, tickets, customers, inventory, movements, shortfalls, metrics or audit |
| Configuration tables (menu, mappings, connections, locations, settings, memberships) | — | writes limited by RLS to the permission matrix; audited by database triggers |
| `public` functions (RPC) | none executable | only the operations listed in `docs/security/rls.md`, each re-checking role and location |
| `private`, `auth`, `cornerops_internal` schemas | not exposed | not exposed (must stay out of "Exposed schemas") |

## Required hosted settings (before any staging use)

1. **Exposed schemas:** `public` only — never `private` or `cornerops_internal`. Preferably disable
   the Data API entirely (the app does not use it), or remove `public` from exposed schemas.
2. **GraphQL:** disable `pg_graphql` if not used.
3. **Default privileges:** Supabase grants new tables/functions to `anon`/`authenticated` by
   default. Our migrations revoke `anon` everywhere and revoke `EXECUTE` from `PUBLIC`/`anon`
   (including default privileges for future objects created by the migration role); every new
   migration must keep granting explicitly. Re-run the Supabase security advisor after applying.
4. **Service role key:** never configured on the web service.
5. **JWT claims:** `auth.uid()` is trusted as the identity; the Data API sets it from the signed
   JWT. Direct database credentials must stay server-side (a raw SQL session could set claims).

## Known caveats

- In local tests the session user is a superuser; a raw client could `RESET ROLE`. On Supabase
  the Data API runs as `authenticator` and cannot do this; direct `DATABASE_URL` access is
  server-only.
- `private.is_demo_email(email)` is executable by `authenticated` (used by a membership trigger)
  and reveals only whether an email is a shared demo identity.
