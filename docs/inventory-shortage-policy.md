# Inventory shortage policy

**Status:** approved by the founder for the controlled pilot (v0.2.1), with the conditions below.
Implemented in `supabase/migrations/20261026100100_order_and_inventory_operations.sql`.

## When it applies

Recipe ingredients are consumed once, when an order is first accepted (`accept`, or
`start_preparing` straight from `new`). If an ingredient's on-hand stock is below the order's
recipe demand, there is a **shortfall**.

## Rules

| # | Condition | Implementation |
|---|---|---|
| 1 | Deduct only what is available | `consume_order_inventory` deducts `least(on_hand, demand)` under a row lock |
| 2 | Never create negative stock automatically | stock goes to 0 at most; `record_inventory_movement` also refuses movements below 0 |
| 3 | Persist requested, consumed and unmet quantities | `inventory_movements.requested_quantity` / `shortfall_quantity`; one `order_inventory_shortfalls` line per ingredient (`requested`, `consumed`, `unmet`). Ingredients not stocked at the location are recorded with no item |
| 4 | Emit `inventory.shortfall` in the same transaction | event + audit entry written by the acceptance transaction itself |
| 5 | High-priority operational alert | critical alert `shortfall:<order>` (Inventory) for every active order with an open shortfall; the order shows a red panel and "Stock shortfall — manager review" |
| 6 | No automatic READY or later while unresolved | `apply_order_transition` refuses `mark_ready`, `mark_picked_up` and `complete`; the UI hides them; the demo simulator skips such orders. Preparing and cancelling remain possible |
| 7 | Authorized manual resolution with full audit | `resolve_order_shortfall(order, method, note)` — OWNER/ADMIN/OPS/BRANCH at the order's location. Audit `inventory.shortfall_resolved` with all lines before/after, method, note and actor |
| 8 | Idempotency and concurrency safety | order row lock + "already consumed" check + unique indexes (one usage movement per order and item; one shortfall line per order and ingredient); items locked in a fixed order |
| 9 | No automatic deduction after a restock | restocking (`purchase`) never touches open shortfalls; only `reconcile_from_stock` deducts, explicitly |
| 10 | Regression tests | `tests/integration/inventory-shortfall.test.ts` (partial stock, zero stock, alert, blocking, retries, concurrent acceptance, concurrent movement, competing orders, restock + reconciliation, partial reconciliation, note requirement, authorization, location scoping) and `inventory-integrity.test.ts` |

## Resolution methods

- **Deduct from current stock** (`reconcile_from_stock`): deducts what is available *now* for each
  open line, recorded as an `adjustment` movement with reason `shortfall_reconciliation` and the
  order reference. Lines that still cannot be met stay open (partially reconciled).
- **Accept shortfall** (`accept_shortfall`): closes all open lines without touching stock — for a
  substitution, an omitted ingredient or a comp. A note is mandatory.

Resolution is idempotent: once nothing is open, further calls change nothing.

## Not covered (by design)

- No automatic re-consumption when an order is cancelled (stock already used is not returned).
- Reservations/holds before acceptance are not modelled.
