#!/bin/bash
# [P12-18] Atomic mkdir lock for heavy jobs (build, restore drill, deploy). Usage:
#   drn-lock.sh acquire <name> [max-age-seconds]   -> exit 0 (held) / 1 (busy)
#   drn-lock.sh release <name>
# A lock whose recorded PID is dead, or older than max-age (default 6h), is cleared.
set -euo pipefail
action="${1:-}"; name="${2:-}"; max_age="${3:-21600}"
[ -n "$action" ] && [ -n "$name" ] || { echo "usage: drn-lock.sh acquire|release <name> [max-age]" >&2; exit 2; }
dir="$HOME/drn/run/$name.lock"
install -d -m 700 "$HOME/drn/run"
case "$action" in
  acquire)
    if [ -d "$dir" ]; then
      pid="$(cat "$dir/pid" 2>/dev/null || echo 0)"
      started="$(cat "$dir/started" 2>/dev/null || echo 0)"
      now="$(date +%s)"
      if { [ "$pid" -gt 0 ] && kill -0 "$pid" 2>/dev/null; } && [ $((now - started)) -lt "$max_age" ]; then
        echo "drn-lock: $name held by pid $pid" >&2
        exit 1
      fi
      rm -rf "$dir"
    fi
    mkdir "$dir" || exit 1
    echo "$PPID" > "$dir/pid"
    date +%s > "$dir/started"
    ;;
  release) rm -rf "$dir" ;;
  *) echo "drn-lock: unknown action $action" >&2; exit 2 ;;
esac
