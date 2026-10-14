#!/bin/bash
# [P12-20] Host monitor, every 300 s by drn.monitor (deployment review C3, D25). Alert-first: the
# only automatic action is one `drn-compose-up.sh` when a core container is not running (no
# maintenance flag, 30-minute cooldown). Three Healthchecks checks:
#   heartbeat  maintenance (overdue -> fail) | docker-api | containers (+ auto-up) | restarts/oom
#              (sticky 60 min) | pg | redis (ping + AOF status) | local-health | disk | backup-age
#              (when state/backup-enabled) | simpay (D16) | jobs (D23, 21-minute grace after a
#              worker start) | mem (two consecutive pressure level 4 readings, sticky 60 min) |
#              isolation (hourly drn-probe; fails when more host ports are open than the recorded
#              baseline state/monitor/probe-baseline)
#   alert      drn-alertscan pending ALERT lines or >= 5 error lines -> fail until `drn-maint ack alerts`
#   access     hourly: https://$DRN_API_HOST/admin/users/me compared with state/access-baseline
#              (status, Location host, no cf-mitigated); fail on any drift, and on no HTTP answer
#              at all (access-unreachable; such a reading is never recorded as the baseline)
# Flags for tests and for P12-04: --access-only, --access-path <path>, --record-access-baseline.
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
drn_load_host_env
install -d -m 700 "$drn_state/monitor" "$drn_logs" "$drn_run"
mon="$drn_state/monitor"
now="$(date +%s)"

access_only=0; access_path="/admin/users/me"; record_baseline=0
while [ $# -gt 0 ]; do
  case "$1" in
    --access-only) access_only=1; shift ;;
    --access-path) access_path="$2"; shift 2 ;;
    --record-access-baseline) record_baseline=1; access_only=1; shift ;;
    *) echo "drn-monitor: unknown argument $1" >&2; exit 2 ;;
  esac
done

# Sticky failures: state/monitor/sticky-<name> holds the epoch until which the item stays failed.
sticky_set() { echo $(( now + ${2:-3600} )) > "$mon/sticky-$1"; }
sticky_active() { local f="$mon/sticky-$1"; [ -f "$f" ] && [ "$(cat "$f")" -gt "$now" ]; }
# Portable epoch from Docker's RFC3339 StartedAt (macOS and GNU date).
epoch_of() {
  local t="${1%%.*}"; t="${t%Z}"
  date -j -u -f '%Y-%m-%dT%H:%M:%S' "$t" +%s 2>/dev/null || date -u -d "${t}Z" +%s 2>/dev/null || echo 0
}
fails=()
note() { fails+=("$1"); drn_log monitor "fail $1"; }

# ---------- access (hourly, or forced) ----------
access_check() {
  [ -n "${DRN_API_HOST:-}" ] || { echo "access: DRN_API_HOST unset, skipped"; return 0; }
  local url="https://$DRN_API_HOST$access_path" hdr status location mitigated obs
  hdr="$(curl -s -m 15 -o /dev/null -D - "$url" 2>/dev/null | tr -d '\r' || true)"
  status="$(printf '%s\n' "$hdr" | awk 'toupper($1) ~ /^HTTP\// {print $2}' | tail -n 1)"
  location="$(printf '%s\n' "$hdr" | awk 'tolower($1) == "location:" {print $2}' | tail -n 1 | sed -E 's#^https?://([^/]+).*#\1#')"
  mitigated="$(printf '%s\n' "$hdr" | grep -ci '^cf-mitigated:' || true)"
  obs="status=${status:-none} location=${location:-none} mitigated=$mitigated"
  # No HTTP status means the probe never reached Cloudflare (DNS, network): it proves nothing about
  # Access, so it is never a baseline and never "no drift".
  if [ -z "$status" ]; then
    if [ "$record_baseline" = 1 ]; then echo "access baseline NOT recorded: $url unreachable" >&2; exit 1; fi
    echo "$now" > "$mon/last-access"
    drn_log monitor "access unreachable: $url"
    hc_ping access fail "access-unreachable"
    return 0
  fi
  if [ "$record_baseline" = 1 ]; then
    echo "$obs" > "$drn_state/access-baseline"; chmod 600 "$drn_state/access-baseline"
    echo "access baseline recorded: $obs"; return 0
  fi
  echo "$now" > "$mon/last-access"
  if [ ! -f "$drn_state/access-baseline" ]; then hc_ping access fail "access-drift:no-baseline"; return 0; fi
  # obs includes mitigated=N, so a challenge differs from the baseline as well.
  if [ "$obs" != "$(cat "$drn_state/access-baseline")" ]; then
    drn_log monitor "access drift: $obs"
    hc_ping access fail "access-drift:${status:-none}"
  else
    hc_ping access "" "$obs"
  fi
}
if [ "$access_only" = 1 ]; then access_check; exit 0; fi

# ---------- heartbeat ----------
# One monitor at a time.
if ! mkdir "$drn_run/monitor.lock" 2>/dev/null; then echo "drn-monitor: already running" >&2; exit 0; fi
trap 'rmdir "$drn_run/monitor.lock" 2>/dev/null' EXIT

maintenance=0
if drn_maint_active; then
  maintenance=1
  if [ "$(drn_maint_expires)" -lt "$now" ] 2>/dev/null; then note "maintenance-overdue:$(drn_maint_reason)"; fi
fi

if ! "$drn_docker" info >/dev/null 2>&1; then
  note "docker-api"
else
  core=(drn-backend drn-worker drn-postgres drn-redis)
  drn_edge_enabled && core+=(drn-cloudflared)
  down=()
  for c in "${core[@]}"; do
    r="$(drn_running "$c")"; h="$(drn_health "$c")"
    if [ "$r" != true ] || { [ "$h" != healthy ] && [ "$h" != none ]; }; then down+=("$c"); fi
    # restart loops and OOM kills
    rc="$("$drn_docker" inspect -f '{{.RestartCount}} {{.State.OOMKilled}}' "$c" 2>/dev/null || echo "0 false")"
    prev="$(cat "$mon/restarts-$c" 2>/dev/null || echo 0)"
    cnt="${rc%% *}"; oom="${rc##* }"
    if [ "$cnt" -gt "$prev" ] 2>/dev/null || [ "$oom" = true ]; then sticky_set "restarts-$c"; drn_log monitor "$c restarts=$cnt oom=$oom"; fi
    echo "$cnt" > "$mon/restarts-$c"
    sticky_active "restarts-$c" && note "restarts:$c"
  done
  if [ "${#down[@]}" -gt 0 ]; then
    note "containers:${down[*]}"
    last_up="$(cat "$mon/last-auto-up" 2>/dev/null || echo 0)"
    if [ "$maintenance" = 0 ] && [ $((now - last_up)) -ge 1800 ]; then
      echo "$now" > "$mon/last-auto-up"
      drn_log monitor "auto-up: ${down[*]} not running; running drn-compose-up.sh"
      bash "$drn_dir/bin/drn-compose-up.sh" >/dev/null 2>&1 || drn_log monitor "auto-up: compose-up exit $?"
    fi
  fi

  if [ "$maintenance" = 0 ]; then
    "$drn_docker" exec drn-postgres sh -c 'pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 || note "pg"
    [ "$("$drn_docker" exec drn-redis redis-cli ping 2>/dev/null)" = PONG ] || note "redis"
    "$drn_docker" exec drn-redis redis-cli info persistence 2>/dev/null | grep -q 'aof_last_write_status:ok' || note "redis-aof"
    [ "$(curl -s -m 10 http://127.0.0.1:3961/health 2>/dev/null)" = OK ] || note "local-health"
    # simpay (D16)
    simpay="$(bash "$drn_dir/bin/drn-drill.sh" simpay status 2>/dev/null || echo "backend=unknown worker=unknown marker=no")"
    case "$simpay" in
      *unknown*) note "simpay-unknown" ;;
      *"backend=on"*|*"worker=on"*)
        if [ -e "$drn_run/simpay-on" ]; then
          since="$(cat "$drn_run/simpay-on")"
          [ $((now - since)) -le 14400 ] || note "simpay-too-long"
        else
          note "simpay-unexpected"
        fi ;;
    esac
    # jobs (D23): worker log must show [JOB-HEARTBEAT] in the last 21 minutes, unless it just started.
    started="$(epoch_of "$("$drn_docker" inspect -f '{{.State.StartedAt}}' drn-worker 2>/dev/null || echo 0)")"
    if [ "$started" -gt 0 ] && [ $((now - started)) -ge 1260 ]; then
      "$drn_docker" logs --since 21m drn-worker 2>&1 | grep -q 'JOB-HEARTBEAT' || note "jobs"
    fi
    # disk
    use="$(df -Pk "$HOME" | awk 'NR==2 {gsub("%","",$5); print $5}')"
    [ "${use:-0}" -lt 90 ] || note "disk-host:${use}%"
    puse="$("$drn_docker" exec drn-postgres df -P /var/lib/postgresql/data 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
    [ "${puse:-0}" -lt 85 ] || note "disk-postgres:${puse}%"
    # backup age
    if [ -e "$drn_state/backup-enabled" ]; then
      newest="$(ls -1t "$drn_dir"/backups/daily/drn-*.manifest 2>/dev/null | head -n 1 || true)"
      if [ -z "$newest" ]; then note "backup-age:none"
      else
        age=$(( now - $(stat -f %m "$newest" 2>/dev/null || stat -c %Y "$newest") ))
        [ "$age" -le 93600 ] || note "backup-age:$((age / 3600))h"
      fi
    fi
  fi
fi

# memory pressure (macOS): two consecutive readings of level 4 -> sticky 60 min
level="$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null || echo 0)"
prev_level="$(cat "$mon/mem-level" 2>/dev/null || echo 0)"
echo "$level" > "$mon/mem-level"
if [ "$level" = 4 ] && [ "$prev_level" = 4 ]; then sticky_set mem; fi
sticky_active mem && note "mem-pressure"

# isolation (hourly): more host ports open than the recorded baseline
last_probe="$(cat "$mon/last-probe" 2>/dev/null || echo 0)"
if [ "$maintenance" = 0 ] && [ -f "$drn_state/probe-baseline" ] && [ $((now - last_probe)) -ge 3600 ] && [ -x "$drn_dir/bin/drn-probe.sh" ]; then
  echo "$now" > "$mon/last-probe"
  out="$(bash "$drn_dir/bin/drn-probe.sh" --network drn_net 2>/dev/null || true)"
  open="$(printf '%s' "$out" | sed -nE 's/.*"open":([0-9]+).*/\1/p')"
  base="$(cat "$drn_state/probe-baseline")"
  if [ -z "$open" ] || [ "$open" -gt "$base" ]; then sticky_set isolation; drn_log monitor "isolation: open=${open:-?} baseline=$base"; fi
fi
sticky_active isolation && note "isolation"

if [ "${#fails[@]}" -gt 0 ]; then
  hc_ping heartbeat fail "${fails[*]}"
elif [ "$maintenance" = 1 ]; then
  hc_ping heartbeat "" "maintenance $(drn_maint_reason)"
else
  hc_ping heartbeat "" "ok"
fi

# ---------- alert ----------
scan="$(bash "$drn_dir/bin/drn-alertscan.sh" 2>/dev/null || echo "alerts=0 errors=0 pending=0")"
pending="$(printf '%s' "$scan" | sed -nE 's/.*pending=([0-9]+).*/\1/p')"
errors="$(printf '%s' "$scan" | sed -nE 's/.*errors=([0-9]+).*/\1/p')"
if [ "${pending:-0}" -gt 0 ] || [ "${errors:-0}" -ge 5 ]; then
  hc_ping alert fail "ALERT x${pending:-0} ERRORS x${errors:-0}"
else
  hc_ping alert "" "$scan"
fi

# ---------- access (hourly) ----------
last_access="$(cat "$mon/last-access" 2>/dev/null || echo 0)"
if [ $((now - last_access)) -ge 3600 ]; then access_check; fi
