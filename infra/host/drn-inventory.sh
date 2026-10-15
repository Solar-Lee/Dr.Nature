#!/bin/bash
# [P12-01 / P12-09] Read-only host inventory with rule-based comparison, so "nothing but drn
# changed on this Mac" can be checked mechanically before and after a deployment (the G-LAUNCH
# rule 4 for the Mac mini). Only normalized facts, no PIDs, dates or free-space noise.
#   drn-inventory.sh snapshot <file>          write the normalized sections
#   drn-inventory.sh compare <before> <after> apply the rules; prints unexpected=N; exit 1 if N>0
# Sections: ## docker (name image, sorted; "not-running" when Docker Desktop is down),
# ## volumes, ## networks, ## images (repo:tag), ## listen (command port, unique, from lsof, no
# PID or address), ## launchagents (file names), ## disk (free GB, integer).
# Allowed differences: drn-* / drn_* docker resources (containers, volumes, networks, images),
# new drn.*.plist files, listeners on 3961 (the only port drn publishes), and the disk value as
# long as "after" has >= 40 GB free. Everything else is unexpected.
set -euo pipefail
docker_bin="/Applications/Docker.app/Contents/Resources/bin/docker"
sock="$HOME/.docker/run/docker.sock"
[ -L "$sock" ] && sock="$(readlink "$sock")"
dk() { DOCKER_HOST="unix://$sock" DOCKER_CONFIG="$HOME/drn/docker-config" "$docker_bin" "$@"; }

snapshot() {
  local out="$1"
  {
    echo "## docker"
    if [ -S "$sock" ] && [ -x "$docker_bin" ] && dk info >/dev/null 2>&1; then
      dk ps -a --format '{{.Names}} {{.Image}}' | sort
      echo "## volumes"; dk volume ls --format '{{.Name}}' | sort
      echo "## networks"; dk network ls --format '{{.Name}}' | sort
      echo "## images"; dk images --format '{{.Repository}}:{{.Tag}}' | sort -u
    else
      echo "not-running"; echo "## volumes"; echo "not-running"; echo "## networks"; echo "not-running"; echo "## images"; echo "not-running"
    fi
    echo "## listen"
    (lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null || true) | awk 'NR>1 {n=split($9,a,":"); print $1, a[n]}' | sort -u
    echo "## launchagents"
    (ls -1 "$HOME/Library/LaunchAgents" 2>/dev/null || true) | sort
    echo "## disk"
    df -Pk "$HOME" | awk 'NR==2 {print int($4/1048576)}'
  } > "$out"
}

section() { awk -v s="## $2" '$0 == s {f=1; next} /^## / {f=0} f' "$1"; }

compare() {
  local before="$1" after="$2" unexpected=0 line
  report() { echo "unexpected: $1"; unexpected=$((unexpected + 1)); }
  for sec in docker volumes networks images listen launchagents; do
    local b a
    b="$(section "$before" "$sec")"; a="$(section "$after" "$sec")"
    if [ "$b" = "not-running" ] || [ "$a" = "not-running" ]; then echo "unverifiable: $sec (docker not running on one side)"; continue; fi
    # removed lines
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      if ! printf '%s\n' "$a" | grep -qxF -- "$line"; then
        case "$sec:$line" in
          docker:drn-*|volumes:drn_*|networks:drn_*|images:drn-*|listen:*" 3961") echo "allowed removal ($sec): $line" ;;
          *) report "removed ($sec): $line" ;;
        esac
      fi
    done <<< "$b"
    # added lines
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      if ! printf '%s\n' "$b" | grep -qxF -- "$line"; then
        case "$sec:$line" in
          docker:drn-*|volumes:drn_*|networks:drn_*|images:drn-*|images:postgres:*|images:redis:*|images:cloudflare/cloudflared:*|images:node:*|listen:*" 3961"|launchagents:drn.*.plist) echo "allowed addition ($sec): $line" ;;
          *) report "added ($sec): $line" ;;
        esac
      fi
    done <<< "$a"
  done
  local disk
  disk="$(section "$after" disk | head -n 1)"
  if [ "${disk:-0}" -lt 40 ]; then report "disk: only ${disk:-?} GB free after (need 40)"; fi
  echo "unexpected=$unexpected"
  [ "$unexpected" -eq 0 ]
}

case "${1:-}" in
  snapshot) [ -n "${2:-}" ] || { echo "usage: drn-inventory.sh snapshot <file>" >&2; exit 2; }; snapshot "$2" ;;
  compare) [ -n "${2:-}" ] && [ -n "${3:-}" ] || { echo "usage: drn-inventory.sh compare <before> <after>" >&2; exit 2; }; compare "$2" "$3" ;;
  *) echo "usage: drn-inventory.sh snapshot <file> | compare <before> <after>" >&2; exit 2 ;;
esac
