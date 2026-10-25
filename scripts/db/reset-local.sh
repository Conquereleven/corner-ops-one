#!/usr/bin/env bash
# Recreate the local development database from migrations (destroys local data only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${LOCAL_PG_PORT:-54329}"
DB="${1:-cornerops}"
"$ROOT/scripts/db/local.sh" start >/dev/null
psql -h 127.0.0.1 -p "$PORT" -U postgres -qc "drop database if exists $DB with (force)" -c "create database $DB"
DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/$DB" npx tsx "$ROOT/scripts/db/migrate.ts" --local-emulation
