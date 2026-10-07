#!/usr/bin/env bash
# Applies the Supabase migration + generated seed to a throwaway local Postgres
# and runs sanity/RLS checks. Requires initdb/pg_ctl/psql on PATH.
set -euo pipefail
export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PORT="${PGPORT_VERIFY:-54329}"
trap 'status=$?; [ $status -ne 0 ] && cat "$TMP/log" 2>/dev/null | tail -5; pg_ctl -D "$TMP/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

initdb -D "$TMP/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP" -l "$TMP/log" start >/dev/null
sleep 1
PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database cornerops;"
"${PSQL[@]}" -d cornerops -f "$ROOT/supabase/migrations/20260927000000_init_restaurant_os.sql"
"${PSQL[@]}" -d cornerops -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -d cornerops -At <<'SQL'
select 'orders: ' || count(*) from orders;
select 'order_items: ' || count(*) from order_items;
select 'active orders: ' || count(*) from orders where status in ('new','accepted','preparing','ready');
select 'menu_items: ' || count(*) from menu_items;
select 'inventory_items: ' || count(*) from inventory_items;
select 'alerts: ' || count(*) from alerts;
select 'daily_metrics days: ' || count(distinct metric_date) from daily_metrics;
select 'revenue by channel (net, all time): ' || string_agg(channel_id || '=' || round(total), ', ' order by total desc)
  from (select channel_id, sum(subtotal - discount) as total from orders where status <> 'cancelled' group by 1) t;
-- RLS check as a non-owner role
create role rls_probe;
grant usage on schema public to rls_probe;
grant select on all tables in schema public to rls_probe;
set role rls_probe;
set request.jwt.claims = '{"app_metadata":{"organization_id":"org_cornerops_demo"}}';
select 'visible orders (own tenant): ' || count(*) from orders;
set request.jwt.claims = '{"app_metadata":{"organization_id":"org_other"}}';
select 'visible orders (other tenant): ' || count(*) from orders;
SQL
echo "✓ migration + seed applied cleanly"
