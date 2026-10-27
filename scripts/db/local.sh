#!/usr/bin/env bash
# Project-local PostgreSQL cluster for development and tests (no Docker needed).
#   scripts/db/local.sh start|stop|status|reset|psql
# Data lives in ./.local/postgres (git-ignored). Port defaults to 54329.
set -euo pipefail
export LC_ALL=C LANG=C
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="$ROOT/.local/postgres"
PORT="${LOCAL_PG_PORT:-54329}"
# cornerops_disposable_cluster marks this cluster as owned by the project and
# disposable; the integration-test guard refuses servers without it.
DBS=("cornerops" "cornerops_test" "cornerops_disposable_cluster")

start() {
  if [ ! -d "$DATA" ]; then
    mkdir -p "$ROOT/.local"
    initdb -D "$DATA" -U postgres --auth=trust --encoding=UTF8 >/dev/null
  fi
  if ! pg_ctl -D "$DATA" status >/dev/null 2>&1; then
    pg_ctl -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=" -l "$ROOT/.local/postgres.log" -w start >/dev/null
  fi
  for db in "${DBS[@]}"; do
    psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc "select 1 from pg_database where datname='$db'" | grep -q 1 \
      || psql -h 127.0.0.1 -p "$PORT" -U postgres -qc "create database $db"
  done
  echo "postgres running on 127.0.0.1:$PORT (databases: ${DBS[*]})"
}

case "${1:-start}" in
  start) start ;;
  stop) pg_ctl -D "$DATA" -m fast stop ;;
  status) pg_ctl -D "$DATA" status ;;
  reset)
    pg_ctl -D "$DATA" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$DATA"
    start ;;
  psql) shift; psql -h 127.0.0.1 -p "$PORT" -U postgres -d "${1:-cornerops}" ;;
  *) echo "usage: $0 start|stop|status|reset|psql"; exit 1 ;;
esac
