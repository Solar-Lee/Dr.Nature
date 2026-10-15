#!/bin/bash
# [P12-18] launchctl for drn.* LaunchAgents only (gui/<uid> domain, Aki's login session).
#   agents.sh enable|disable|kick|status <drn.label>...
set -euo pipefail
action="${1:-}"; shift || true
[ -n "$action" ] && [ $# -gt 0 ] || { echo "usage: agents.sh enable|disable|kick|status <drn.label>..." >&2; exit 2; }
uid="$(id -u)"
for label in "$@"; do
  case "$label" in drn.*) ;; *) echo "agents.sh: refusing non-drn label $label" >&2; exit 2 ;; esac
  plist="$HOME/Library/LaunchAgents/$label.plist"
  case "$action" in
    enable)
      [ -f "$plist" ] || { echo "agents.sh: $plist missing (run install.sh)" >&2; exit 1; }
      launchctl bootstrap "gui/$uid" "$plist" 2>/dev/null || launchctl enable "gui/$uid/$label"
      launchctl print "gui/$uid/$label" >/dev/null
      echo "enabled $label"
      ;;
    disable)
      launchctl bootout "gui/$uid/$label" 2>/dev/null || true
      echo "disabled $label"
      ;;
    kick) launchctl kickstart -k "gui/$uid/$label"; echo "kicked $label" ;;
    status) launchctl print "gui/$uid/$label" 2>/dev/null | grep -E 'state =|last exit code|pid =' || echo "$label: not loaded" ;;
    *) echo "agents.sh: unknown action $action" >&2; exit 2 ;;
  esac
done
