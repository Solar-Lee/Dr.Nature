#!/bin/bash
# [P12-18] Started by launchd (drn.compose-up, RunAtLoad) after Aki's login, and by the monitor's
# auto-up (D25). Refuses to touch containers while a maintenance flag exists (a deploy in
# progress must not be "repaired" by a reboot), waits for the Docker API, scans logs first, then
# `drn-compose up -d --wait` and a local /health check. Each failure sends one distinct /fail.
# Exit codes: 0 ok, 3 maintenance, 4 docker API, 5 up failed, 6 health failed.
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
drn_load_host_env
install -d -m 700 "$drn_logs" "$drn_run" "$drn_state/monitor"

if drn_maint_active; then
  drn_log compose-up "refused: maintenance flag ($(drn_maint_reason))"
  hc_ping heartbeat fail "compose-up:maintenance $(drn_maint_reason)"
  exit 3
fi

waited=0
until "$drn_docker" info >/dev/null 2>&1; do
  if [ "$waited" -ge 300 ]; then
    drn_log compose-up "docker API not reachable after 300s"
    hc_ping heartbeat fail "compose-up:docker"
    exit 4
  fi
  sleep 5; waited=$((waited + 5))
done

bash "$drn_dir/bin/drn-alertscan.sh" >/dev/null || true

if ! "$drn_dir/bin/drn-compose" up -d --wait --wait-timeout 600; then
  drn_log compose-up "up failed"
  hc_ping heartbeat fail "compose-up:up"
  exit 5
fi

if ! curl -fsS -m 10 http://127.0.0.1:3961/health >/dev/null 2>&1; then
  drn_log compose-up "local /health failed after up"
  hc_ping heartbeat fail "compose-up:health"
  exit 6
fi
drn_log compose-up "ok"
date +%s > "$drn_state/monitor/last-compose-up"
hc_ping heartbeat "" "compose-up:ok"
