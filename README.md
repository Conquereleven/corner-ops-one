# CornerOps · Restaurant OS (v0.1)

> One restaurant. Many sales channels. One operating system.

CornerOps Restaurant OS is an operational command center for restaurants selling through
Talabat, Deliveroo, Noon Food, Keeta, their own website and WhatsApp. It sits **above** the
delivery platforms and the POS: every channel feeds one normalized order model, one kitchen
board, one inventory and one view of what each channel actually earns.

The demo tenant is **Casa Norte Mexican Kitchen** (Dubai Marina · Business Bay · JVC), AED, Asia/Dubai.

---

## Run it

```bash
npm install
cp .env.example .env.local        # then set SESSION_SECRET (openssl rand -base64 48)
npm run dev                       # http://localhost:3000 → "Enter demo workspace"
```

| Script | What it does |
|---|---|
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:seed:export` | Regenerates `supabase/seed.sql` from the same generator the app uses |
| `npm run db:verify` | Spins up a throwaway local Postgres, applies migration + seed, checks counts and RLS isolation |

No Talabat, Deliveroo, Noon or Keeta credentials are needed — every integration runs in **mock mode**.

---

## Demo script (≈5 minutes)

1. **Overview** — the Command Center: revenue, orders, AOV, active orders, prep time and cancellation rate vs the same time yesterday; live pipeline; channel health; revenue by channel; the three locations; operational alerts.
2. The three locations appear in the locations table and the top-bar **location selector** (scopes the whole workspace).
3. Talabat, Deliveroo, Noon, Keeta, Direct and WhatsApp revenue sit side by side in **Revenue by channel**.
4. Open **Demo mode** (amber pill, top bar) → pick *Dubai Marina* → **Talabat**. A simulated Talabat payload goes through the Talabat adapter and lands as a UnifiedOrder; a toast announces it.
5. Click **Open** on the toast (or find it in **Live Orders**).
6. **Accept** — the status is written back to the (simulated) Talabat API; see *Channel sync* on the order.
7. **Start preparing**.
8. Open **Kitchen** — the ticket is in *Preparing* with a live timer and NORMAL / WARNING / CRITICAL priority. *Kitchen display mode* gives a full-screen dark KDS for tablets.
9. **Mark ready** from the kitchen ticket.
10. **Mark picked up**.
11. Back on **Overview** — pipeline, revenue and channel numbers have moved.
12. **Analytics** — compare channels (revenue, AOV, prep, cancellations), locations, hourly volume, top/bottom products, marketplace concentration.
13. **Profitability** — estimated contribution margin per channel: gross sales → discounts → commission → delivery/payment fees → food cost → contribution. *Which platform actually makes me money?*
14. **Inventory** — stock alerts (low / critical / out), run-out forecasts, and menu items blocked by stock.
15. **AI Operations** — daily briefing, risks, opportunities, suggested actions, and *Ask CornerOps*.

Orders injected from the Demo mode panel are never auto-progressed by the simulator, so the presenter stays in control. *Settings → Demo mode → Reset demo data* regenerates everything anchored to the current time.

---

## Architecture

A modular monolith on **Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui (Base UI) · TanStack Query · Zod · Recharts**.

```
Talabat ─────┐
Deliveroo ───┤
Noon Food ───┤   Channel adapters         normalizeOrder()        CornerOps core
Keeta ───────┼─► (mock today; live  ────► UnifiedOrder ─────────► orders · kitchen · inventory
Website ─────┤    later, same interface)   (Zod-validated          alerts · analytics · AI
WhatsApp ────┘                              payloads)
```

```
src/
  domain/          Pure business logic — no React, no I/O
    orders/          UnifiedOrder model, state machine, SLA engine
    channels/        channel catalog, connection & economics types
    menu/ inventory/ recipes, stock status, availability, run-out forecasts
    analytics/       metrics, date ranges, channel profitability
    alerts/          alert engine (stable ids per condition)
    ai/              OperationsSnapshot, briefing builder, provider interface + deterministic analyst
  adapters/        One folder per channel: external schema (Zod) · normalize.ts · mock.ts
    shared/          MockChannelAdapter base, UnifiedOrder builder
    registry.ts      mock vs live resolution (live throws IntegrationUnavailableError in v0.1)
  server/
    services/        Use cases called by route handlers and server-side prefetching
    simulation/      Demo engine: traffic generator, auto-progression, channel incidents
    seed/            Casa Norte catalog + deterministic generator (30 days of history)
    store/           In-memory demo database, mock platform backend
    auth/            Signed demo session (HMAC via Web Crypto)
  app/
    (app)/           Workspace pages (server components prefetch → client views hydrate)
    (display)/kds    Full-screen kitchen display
    api/             Route handlers — Zod-validated inputs, typed JSON errors
  components/      UI by module (dashboard, orders, kitchen, menu, inventory, channels, analytics, ai, …)
  hooks/           TanStack Query hooks (polling, optimistic order actions)
supabase/
  migrations/      Postgres schema with RLS tenant isolation
  seed.sql         Generated demo dataset
```

### Key design decisions

- **The UI only ever sees `UnifiedOrder`.** Each adapter owns its platform's payload shape
  (Talabat decimals, Deliveroo minor units, Noon epoch-ms, Keeta unix-seconds + fils, WhatsApp
  carts without totals) and maps it with a pure `normalize*Order` function. Platform-specific
  fields stay in `metadata`.
- **Mock vs live is explicit.** `MockChannelAdapter` talks to a simulated platform (inbox,
  connection state, latency, write-back vocabulary). `createLiveAdapter()` throws — nothing
  pretends to be connected. Orders, logs and badges are labelled *Mock integration* / *Demo data*.
- **Seeded orders go through the adapters too.** The generator fabricates each historical order
  as a platform payload and normalizes it, so seed data exercises the same path as live traffic.
- **One transition path.** Staff actions and the simulator both call `transitionOrder()`:
  state machine → side effects (inventory usage, courier) → channel write-back → sync status.
  The state machine is pure, so the client applies the same transition optimistically.
- **Multi-location and multi-tenant by design.** Every entity carries `organization_id` and,
  where relevant, `location_id`. The location scope (`All locations` or one branch) is a cookie
  shared by server prefetching and client queries.
- **Server-first data.** Pages are server components that call services directly and dehydrate
  into TanStack Query; client components then poll for live updates. Secrets never reach the client.
- **Grounded AI.** Providers receive a structured `OperationsSnapshot` built from live data.
  v0.1 ships a deterministic analyst; an LLM provider can implement `OperationsAIProvider` and be
  registered in `server/services/ai.ts` with its key held server-side.

### Data & persistence

v0.1 runs on an **in-memory store** seeded at boot (deterministic, anchored to "now"), which keeps
the live demo self-contained. The Postgres schema in `supabase/migrations` mirrors it table for
table (organizations, users, restaurants, locations, channels, channel_connections, orders,
order_items, menu_categories, menu_items, menu_channel_mappings, inventory_items,
inventory_movements, customers, kitchen_tickets, alerts, daily_metrics, …) with Row Level
Security scoped to `app_metadata.organization_id`. `npm run db:verify` applies it plus the
generated seed to a local Postgres and checks tenant isolation.

**Next step:** a Supabase-backed repository behind the same service layer. Until then, state
lives in one server process and resets on restart — fine for demos, not for multi-instance
production.

### Metric definitions

- **Revenue** = net food sales (subtotal − discounts), excluding VAT and delivery fees; cancelled orders excluded.
- **Prep time** = accepted → ready. **Cancellation rate** = cancelled ÷ all orders placed.
- "Today" comparisons are against the **same time yesterday** (Asia/Dubai).
- **Profitability** is an estimate from order data plus contract terms editable in *Settings → Channel economics*.

---

## Not in v0.1 (by design)

Real Talabat / Deliveroo / Noon / Keeta integrations, real payments, accounting, payroll/HR,
procurement, driver fleet, full POS, ERP. The adapter, economics and inventory models are built
to take these on later.
