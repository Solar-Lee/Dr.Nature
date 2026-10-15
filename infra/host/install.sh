#!/bin/bash
# [P12-18] Installs the drn host package into ~/drn and ~/Library/LaunchAgents (idempotent; run
# again after every host-script change). It NEVER creates ~/drn/.env (drn-gen-env.sh, by Aki),
# never enables a LaunchAgent (agents.sh), and only ever writes under ~/drn and drn.*.plist.
#   bash infra/host/install.sh
set -euo pipefail
umask 077
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="$HOME/drn"
install -d -m 700 "$dir" "$dir/bin" "$dir/docker-config" "$dir/cloudflared" "$dir/backups" "$dir/backups/daily" "$dir/backups/weekly" \
  "$dir/backups/pre" "$dir/backups/tmp" "$dir/logs" "$dir/state" "$dir/state/monitor" "$dir/run" "$dir/drill"

# Client config only when absent (nothing else ever edits it).
[ -e "$dir/docker-config/config.json" ] || install -m 600 "$src/docker-config.json" "$dir/docker-config/config.json"

# Compose files and scripts (700; the quarantine attribute from a copied tree is dropped).
install -m 600 "$src/../docker-compose.prod.yml" "$dir/docker-compose.prod.yml"
install -m 600 "$src/../drill-simulated-payments.yml" "$dir/drill-simulated-payments.yml"
install -m 600 "$src/../backend.Dockerfile" "$dir/backend.Dockerfile"
count=0
for f in "$src"/drn-* "$src"/agents.sh "$src"/install.sh; do
  [ -f "$f" ] || continue
  install -m 700 "$f" "$dir/bin/$(basename "$f")"
  xattr -d com.apple.quarantine "$dir/bin/$(basename "$f")" 2>/dev/null || true
  count=$((count + 1))
done

# LaunchAgent templates: __HOME__ -> $HOME, validated with plutil; never loaded here.
install -d -m 700 "$HOME/Library/LaunchAgents"
for t in "$src"/launchd/drn.*.plist; do
  [ -f "$t" ] || continue
  out="$HOME/Library/LaunchAgents/$(basename "$t")"
  sed "s#__HOME__#$HOME#g" "$t" > "$out.tmp"
  if command -v plutil >/dev/null 2>&1; then
    plutil -lint "$out.tmp" >/dev/null || { echo "install.sh: invalid plist $t" >&2; rm -f "$out.tmp"; exit 1; }
  fi
  chmod 600 "$out.tmp"; mv "$out.tmp" "$out"
done

# Secrets templates only when absent; .env is never touched.
[ -e "$dir/tunnel.env" ] || { : > "$dir/tunnel.env"; chmod 600 "$dir/tunnel.env"; }
[ -e "$dir/host.env" ] || {
  printf 'DRN_API_HOST=\nDRN_HC_HEARTBEAT_URL=\nDRN_HC_ALERT_URL=\nDRN_HC_ACCESS_URL=\nDRN_HC_BACKUP_URL=\nDRN_HC_DRILL_URL=\nDRN_R2_REMOTE=\n' > "$dir/host.env"
  chmod 600 "$dir/host.env"
}
echo "installed $count scripts into $dir/bin; agents not enabled; .env untouched"
