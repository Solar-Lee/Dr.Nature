#!/bin/bash
# [P12-18] Simulated-payment flag for an ATM/CVS sandbox drill (D16). The flag lives ONLY in the
# container configuration (compose override); on/off rebuild drn-backend and drn-worker.
#   drn-drill.sh simpay on      quiet + alertscan + recreate with the override + marker run/simpay-on
#   drn-drill.sh simpay off     alertscan + recreate from the base file; marker removed; maint end
#   drn-drill.sh simpay status  prints backend=on|off worker=on|off (exit 0); other exec exit codes
#                               print unknown and exit 1
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
install -d -m 700 "$drn_run"
[ "${1:-}" = "simpay" ] || { echo "usage: drn-drill.sh simpay on|off|status" >&2; exit 2; }
marker="$drn_run/simpay-on"

flag_state() { # container -> on|off|unknown
  local c="$1"
  if [ "$(drn_running "$c")" != "true" ]; then echo unknown; return; fi
  set +e
  "$drn_docker" exec "$c" sh -c '[ "${ECPAY_ACCEPT_SIMULATED_PAYMENTS:-}" = true ] && exit 10; exit 0' >/dev/null 2>&1
  local code=$?
  set -e
  case "$code" in 10) echo on ;; 0) echo off ;; *) echo unknown ;; esac
}

case "${2:-}" in
  on)
    "$drn_dir/bin/drn-maint" quiet simpay-drill 120
    bash "$drn_dir/bin/drn-alertscan.sh" >/dev/null || true
    "$drn_dir/bin/drn-compose" --drill up -d --wait --wait-timeout 600 drn-backend drn-worker
    date +%s > "$marker"
    drn_log drill "simpay on"
    ;;
  off)
    bash "$drn_dir/bin/drn-alertscan.sh" >/dev/null || true
    "$drn_dir/bin/drn-compose" up -d --wait --wait-timeout 600 drn-backend drn-worker
    rm -f "$marker"
    b="$(flag_state drn-backend)"; w="$(flag_state drn-worker)"
    [ "$b" = off ] && [ "$w" = off ] || { echo "drn-drill: flag still on (backend=$b worker=$w)" >&2; exit 1; }
    drn_log drill "simpay off"
    "$drn_dir/bin/drn-maint" end
    ;;
  status)
    b="$(flag_state drn-backend)"; w="$(flag_state drn-worker)"
    echo "backend=$b worker=$w marker=$([ -e "$marker" ] && echo yes || echo no)"
    [ "$b" != unknown ] && [ "$w" != unknown ]
    ;;
  *) echo "usage: drn-drill.sh simpay on|off|status" >&2; exit 2 ;;
esac
