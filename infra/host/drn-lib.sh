#!/bin/bash
# [P12-18] Shared helpers for the drn host scripts (sourced; never run directly).
# Conventions: every script is `set -euo pipefail`, uses $drn_docker for Docker, never prints a
# secret, never reads ~/drn/.env on the host (values are expanded INSIDE containers).
drn_dir="$HOME/drn"
drn_docker="$drn_dir/bin/drn-docker"
drn_logs="$drn_dir/logs"
drn_state="$drn_dir/state"
drn_run="$drn_dir/run"

drn_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Appends a line to logs/<name>.log (created 600).
drn_log() {
  local name="$1"; shift
  install -d -m 700 "$drn_logs"
  [ -e "$drn_logs/$name.log" ] || { : > "$drn_logs/$name.log"; chmod 600 "$drn_logs/$name.log"; }
  printf '%s %s\n' "$(drn_now)" "$*" >> "$drn_logs/$name.log"
}

# Loads host.env (Healthchecks URLs, rclone remote) without echoing anything.
drn_load_host_env() {
  if [ -f "$drn_dir/host.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$drn_dir/host.env"
    set +a
  fi
}

# hc_ping <check> <status> [body]: status is "" (success), start, fail or log.
# Always prints one line `hc <check> <status> <body>` (the tests run without network); only
# contacts Healthchecks when the matching ping URL from host.env is set. Never fails the caller.
hc_ping() {
  local check="$1" status="${2:-}" body="${3:-}" url=""
  case "$check" in
    heartbeat) url="${DRN_HC_HEARTBEAT_URL:-}" ;;
    alert) url="${DRN_HC_ALERT_URL:-}" ;;
    access) url="${DRN_HC_ACCESS_URL:-}" ;;
    backup) url="${DRN_HC_BACKUP_URL:-}" ;;
    drill) url="${DRN_HC_DRILL_URL:-}" ;;
  esac
  printf 'hc %s %s %s\n' "$check" "${status:-ok}" "$body"
  if [ -n "$url" ]; then
    local suffix=""
    [ -n "$status" ] && suffix="/$status"
    curl -fsS -m 10 --retry 5 -o /dev/null --data-raw "$body" "$url$suffix" >/dev/null 2>&1 || drn_log monitor "hc_ping $check$suffix failed to send"
  fi
}

# Maintenance flag: run/maintenance holds "<reason>|<expires epoch>".
drn_maint_flag="$HOME/drn/run/maintenance"
drn_maint_active() { [ -e "$drn_maint_flag" ]; }
drn_maint_reason() { cut -d'|' -f1 "$drn_maint_flag" 2>/dev/null || true; }
drn_maint_expires() { cut -d'|' -f2 "$drn_maint_flag" 2>/dev/null || true; }

# psql inside drn-postgres; credentials expand inside the container (never read on the host).
# Usage: drn_pg_sql "select 1" [container]
drn_pg_sql() {
  local sql="$1" container="${2:-drn-postgres}"
  printf '%s\n' "$sql" | "$drn_docker" exec -i "$container" sh -c 'psql -AtX -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# Business-table fingerprint (C11): counts and newest updated_at of the tables a shopper or ECPay
# can write; 12 hex chars. Table names per Medusa 2.21.2 migrations.
drn_fingerprint() {
  local container="${1:-drn-postgres}"
  drn_pg_sql "select 'order',count(*),coalesce(max(updated_at)::text,'') from \"order\"
union all select 'payment',count(*),coalesce(max(updated_at)::text,'') from payment
union all select 'payment_collection',count(*),coalesce(max(updated_at)::text,'') from payment_collection
union all select 'payment_session',count(*),coalesce(max(updated_at)::text,'') from payment_session
union all select 'fulfillment',count(*),coalesce(max(updated_at)::text,'') from fulfillment
union all select 'customer',count(*),coalesce(max(updated_at)::text,'') from customer
union all select 'product',count(*),coalesce(max(updated_at)::text,'') from product
order by 1" "$container" | shasum -a 256 | cut -c1-12
}

# Container state helpers (always with -f: never dump Config.Env).
drn_running() { "$drn_docker" inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false; }
drn_health() { "$drn_docker" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo missing; }

# Edge profile flag.
drn_edge_enabled() { [ -e "$HOME/drn/state/edge-enabled" ]; }
