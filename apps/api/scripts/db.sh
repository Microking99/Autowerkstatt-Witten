#!/usr/bin/env bash
# Lokaler PostgreSQL-16-Cluster für Entwicklung und Tests (ohne Systemdienst, ohne root).
#
#   bash scripts/db.sh start    # Cluster anlegen (falls nötig) und starten, Datenbanken anlegen
#   bash scripts/db.sh stop     # Cluster stoppen
#   bash scripts/db.sh status   # Zustand anzeigen
#
# Daten liegen unter apps/api/.data/pg (nicht versioniert). Der Cluster lauscht nur auf
# 127.0.0.1:54329 und nimmt lokale Verbindungen ohne Passwort an (trust). Nur für die
# Entwicklung gedacht, niemals für Produktionsdaten.
#
# Läuft das Skript als root (z. B. in Containern), werden initdb/pg_ctl als Benutzer
# "postgres" (oder PG_RUN_AS) ausgeführt, weil PostgreSQL nicht als root startet.
set -euo pipefail

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
DATA_ROOT="$API_DIR/.data"
PGDATA_DIR="$DATA_ROOT/pg"
LOG_FILE="$DATA_ROOT/postgres.log"
PORT="${LOCAL_PG_PORT:-54329}"
DB_USER="werkstatt"
DATABASES=("werkstatt_dev" "werkstatt_test")

run_pg() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u "${PG_RUN_AS:-postgres}" -- "$@"
  else
    "$@"
  fi
}

is_running() {
  [ -f "$PGDATA_DIR/PG_VERSION" ] && run_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1
}

psql_admin() {
  "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -tA "$@"
}

start() {
  mkdir -p "$DATA_ROOT"
  if [ "$(id -u)" = "0" ]; then
    chown "${PG_RUN_AS:-postgres}" "$DATA_ROOT"
  fi
  if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
    echo "Lege lokalen Cluster an: $PGDATA_DIR"
    run_pg "$PG_BIN/initdb" -D "$PGDATA_DIR" -U "$DB_USER" --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  fi
  if is_running; then
    echo "PostgreSQL läuft bereits (Port $PORT)."
  else
    run_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -l "$LOG_FILE" -w \
      -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
      start >/dev/null
    echo "PostgreSQL gestartet (127.0.0.1:$PORT)."
  fi
  for db in "${DATABASES[@]}"; do
    if [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$db'")" != "1" ]; then
      psql_admin -c "CREATE DATABASE $db" >/dev/null
      echo "Datenbank angelegt: $db"
    fi
  done
  echo "DATABASE_URL=postgres://$DB_USER@127.0.0.1:$PORT/werkstatt_dev"
  echo "TEST_DATABASE_URL=postgres://$DB_USER@127.0.0.1:$PORT/werkstatt_test"
}

stop() {
  if is_running; then
    run_pg "$PG_BIN/pg_ctl" -D "$PGDATA_DIR" -m fast -w stop >/dev/null
    echo "PostgreSQL gestoppt."
  else
    echo "PostgreSQL läuft nicht."
  fi
}

status() {
  if is_running; then
    echo "läuft (127.0.0.1:$PORT, Daten: $PGDATA_DIR)"
  else
    echo "gestoppt"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    echo "Aufruf: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
