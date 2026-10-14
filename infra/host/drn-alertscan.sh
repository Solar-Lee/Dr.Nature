#!/bin/bash
# [P12-18] Scans drn-backend and drn-worker logs for lines a human must act on (deployment
# review C12): [ECPAY-ALERT], [PROMO-ALERT], [EMAIL-ALERT], [MEMBERSHIP-ALERT], plus a count of
# error-level lines. Each container has its own cursor (state/monitor/cursor-<name>), so nothing
# is missed across runs or container rebuilds; hits go to logs/alerts-YYYYMM.log and the pending
# counter (state/monitor/alerts-pending) grows until `drn-maint ack alerts`.
#   drn-alertscan.sh                      scan from the cursors, advance them
#   drn-alertscan.sh --count-since <ISO> [--exclude <text>]
#                                         count only (no cursor change): prints alerts=N errors=M
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
install -d -m 700 "$drn_state/monitor" "$drn_logs" "$drn_run"

count_since=""; exclude=""
while [ $# -gt 0 ]; do
  case "$1" in
    --count-since) count_since="$2"; shift 2 ;;
    --exclude) exclude="$2"; shift 2 ;;
    *) echo "drn-alertscan: unknown argument $1" >&2; exit 2 ;;
  esac
done

alert_re='\[(ECPAY|PROMO|EMAIL|MEMBERSHIP)-ALERT\]'
scan() { # container since until -> prints "alerts errors" and appends hits to $hits
  local c="$1" since="$2" until="$3" out
  out="$("$drn_docker" logs --timestamps --since "$since" --until "$until" "$c" 2>&1 || true)"
  if [ -n "$exclude" ]; then out="$(printf '%s\n' "$out" | grep -vF -- "$exclude" || true)"; fi
  local a e
  a="$(printf '%s\n' "$out" | grep -cE "$alert_re" || true)"
  e="$(printf '%s\n' "$out" | grep -cE '"level":"error"|\berror\b' || true)"
  printf '%s\n' "$out" | grep -E "$alert_re" | sed "s/^/$c /" >> "$hits" || true
  echo "$a $e"
}

now="$(drn_now)"
hits="$(mktemp)"
total_a=0; total_e=0
if [ -n "$count_since" ]; then
  for c in drn-backend drn-worker; do
    read -r a e <<< "$(scan "$c" "$count_since" "$now")"
    total_a=$((total_a + a)); total_e=$((total_e + e))
  done
  rm -f "$hits"
  echo "alerts=$total_a errors=$total_e"
  exit 0
fi

# Cursor mode: one scan at a time.
lock="$drn_run/alertscan.lock"
if ! mkdir "$lock" 2>/dev/null; then echo "drn-alertscan: another scan is running" >&2; rm -f "$hits"; exit 0; fi
trap 'rmdir "$lock" 2>/dev/null; rm -f "$hits"' EXIT
for c in drn-backend drn-worker; do
  cursor_file="$drn_state/monitor/cursor-$c"
  since="$(cat "$cursor_file" 2>/dev/null || date -u -v-1H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"
  read -r a e <<< "$(scan "$c" "$since" "$now")"
  total_a=$((total_a + a)); total_e=$((total_e + e))
  printf '%s\n' "$now" > "$cursor_file"
done
if [ -s "$hits" ]; then
  month="$(date -u +%Y%m)"
  f="$drn_logs/alerts-$month.log"
  [ -e "$f" ] || { : > "$f"; chmod 600 "$f"; }
  cat "$hits" >> "$f"
fi
pending_file="$drn_state/monitor/alerts-pending"
pending="$(cat "$pending_file" 2>/dev/null || echo 0)"
pending=$((pending + total_a))
echo "$pending" > "$pending_file"
errors_file="$drn_state/monitor/errors-last"
echo "$total_e" > "$errors_file"
echo "alerts=$total_a errors=$total_e pending=$pending"
