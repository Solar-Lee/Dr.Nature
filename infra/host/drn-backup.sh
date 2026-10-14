#!/bin/bash
# [P12-08] Database (and uploads) backup on the Mac mini (deployment review D18, C5).
#   drn-backup.sh daily                       04:15 Asia/Taipei by drn.backup: DB + globals + uploads
#   drn-backup.sh pre <old>-<new>             before an upgrade, writers already stopped: DB + globals
#   drn-backup.sh pre-rollback                before a destructive restore; never auto-deleted
#   drn-backup.sh --retention-test <dir>      apply the retention rules to <dir> only (tests)
# Options: --pg-container <name> (default drn-postgres), --uploads-volume <name> (default
# drn_uploads), --r2-remote <remote:bucket> (default DRN_R2_REMOTE from host.env).
# Output set in ~/drn/backups/<daily|pre|pre-rollback>/: drn-<ts>.dump (pg_dump -Fc, run inside
# drn-postgres over its unix socket), drn-<ts>.globals.sql (--no-role-passwords),
# drn-<ts>.uploads.tar.gz (daily; one-off container, --network none, volume read-only),
# drn-<ts>.manifest (key=value: toc, sha256, anchors before/after; local only).
# Verification: every docker exec exit code; pg_restore --list entries >= 90 % of the previous
# backup (first backup: > 0). Retention: daily 14 sets, weekly 8 (Sunday copies), pre 3.
# Offsite (when age-recipients.txt has a key and a remote is set): age -R encryption, rclone copyto,
# size check with rclone lsjson. With ~/drn/state/offsite-required, a missing offsite is a failure.
# Healthchecks: /start, then success with "toc=N sha=<12> offsite=ok|unset", or /fail with line+code.
set -euo pipefail
umask 077
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
drn_load_host_env

backups="$drn_dir/backups"
keep_daily=14; keep_weekly=8; keep_pre=3

# Keeps the newest <keep> sets (a set = files sharing the drn-<ts> prefix) in <dir>.
retain() {
  local dir="$1" keep="$2" n=0 set
  [ -d "$dir" ] || return 0
  for set in $(ls -1 "$dir" | sed -nE 's/^(drn-[0-9TZ]+)\..*/\1/p' | sort -u -r); do
    n=$((n + 1))
    if [ "$n" -gt "$keep" ]; then rm -f "$dir/$set".*; fi
  done
}

mode=""; label=""; pg="drn-postgres"; uploads_volume="drn_uploads"; remote="${DRN_R2_REMOTE:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    daily|pre-rollback) mode="$1"; shift ;;
    pre) mode="pre"; label="${2:-}"; shift 2 || { echo "usage: drn-backup.sh pre <old>-<new>" >&2; exit 2; } ;;
    --retention-test) retain "$2" "$keep_daily"; exit 0 ;;
    --pg-container) pg="$2"; shift 2 ;;
    --uploads-volume) uploads_volume="$2"; shift 2 ;;
    --r2-remote) remote="$2"; shift 2 ;;
    *) echo "drn-backup: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$mode" ] || { echo "usage: drn-backup.sh daily|pre <old>-<new>|pre-rollback [options]" >&2; exit 2; }
[ "$mode" != pre ] || [ -n "$label" ] || { echo "drn-backup: pre needs <old>-<new>" >&2; exit 2; }

rid="$(date +%s)$$"
[ "$mode" = daily ] && hc_ping backup start "rid=$rid"
fail() {
  local code="$1" line="$2"
  drn_log backup "FAIL mode=$mode line=$line exit=$code"
  hc_ping backup fail "line=$line exit=$code mode=$mode"
  exit "$code"
}
trap 'fail $? $LINENO' ERR

install -d -m 700 "$backups/daily" "$backups/weekly" "$backups/pre" "$backups/pre-rollback" "$backups/tmp"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$backups/tmp"
base="drn-$ts"

anchors_before="$(drn_anchors "$pg")"
"$drn_docker" exec "$pg" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp/$base.dump"
"$drn_docker" exec "$pg" sh -c 'pg_dumpall -U "$POSTGRES_USER" --globals-only --no-role-passwords' > "$tmp/$base.globals.sql"
anchors_after="$(drn_anchors "$pg")"
fingerprint="$(drn_fingerprint "$pg")"
toc="$("$drn_docker" exec -i "$pg" pg_restore --list < "$tmp/$base.dump" | grep -vc '^;' || true)"
[ "${toc:-0}" -gt 0 ] || { echo "drn-backup: empty pg_restore --list" >&2; false; }

case "$mode" in daily) dest="$backups/daily" ;; pre) dest="$backups/pre" ;; *) dest="$backups/pre-rollback" ;; esac
prev="$(ls -1 "$dest"/drn-*.manifest 2>/dev/null | sort | tail -n 1 || true)"
if [ -n "$prev" ]; then
  prev_toc="$(drn_manifest_get "$prev" toc)"
  if [ "$((toc * 10))" -lt "$((prev_toc * 9))" ]; then
    echo "drn-backup: toc $toc < 90% of previous $prev_toc" >&2; false
  fi
fi

uploads_files="-"
if [ "$mode" = daily ]; then
  "$drn_docker" run --rm --network none -v "$uploads_volume:/src:ro" --entrypoint tar "$drn_pg_image" -C /src -czf - . > "$tmp/$base.uploads.tar.gz"
  gzip -t "$tmp/$base.uploads.tar.gz"
  uploads_files="$(tar -tzf "$tmp/$base.uploads.tar.gz" | grep -vc '/$' || true)"
fi

dump_sha="$(shasum -a 256 "$tmp/$base.dump" | cut -d' ' -f1)"
{
  echo "ts=$ts"
  echo "mode=$mode"
  echo "label=${label:--}"
  echo "toc=$toc"
  echo "dump_sha256=$dump_sha"
  echo "anchors_before=$anchors_before"
  echo "anchors_after=$anchors_after"
  echo "fingerprint=$fingerprint"
  echo "uploads_files=$uploads_files"
} > "$tmp/$base.manifest"
mv "$tmp/$base".* "$dest/"

# Retention (pre-rollback is never deleted automatically).
case "$mode" in
  daily)
    if [ "$(TZ=Asia/Taipei date +%u)" = 7 ]; then cp -p "$dest/$base".* "$backups/weekly/"; fi
    retain "$backups/daily" "$keep_daily"; retain "$backups/weekly" "$keep_weekly" ;;
  pre) retain "$backups/pre" "$keep_pre" ;;
esac

# Offsite copy.
offsite="unset"
recipients="$drn_dir/age-recipients.txt"
if [ -n "$remote" ] && [ -s "$recipients" ] && command -v age >/dev/null && command -v rclone >/dev/null; then
  offsite="ok"
  for f in "$dest/$base".dump "$dest/$base".globals.sql "$dest/$base".uploads.tar.gz; do
    [ -f "$f" ] || continue
    age -R "$recipients" -o "$f.age" "$f"
    rclone copyto "$f.age" "$remote/$mode/$(basename "$f").age"
    local_size="$(wc -c < "$f.age" | tr -d ' ')"
    remote_size="$(rclone lsjson "$remote/$mode/$(basename "$f").age" | sed -nE 's/.*"Size":([0-9]+).*/\1/p' | head -n 1)"
    rm -f "$f.age"
    [ "$local_size" = "$remote_size" ] || { offsite="size-mismatch"; break; }
  done
fi
if [ "$offsite" != ok ] && [ -e "$drn_state/offsite-required" ]; then
  echo "drn-backup: offsite required but $offsite" >&2
  false
fi

trap - ERR
drn_log backup "ok mode=$mode $base toc=$toc offsite=$offsite"
[ "$mode" = daily ] && hc_ping backup "" "toc=$toc sha=${dump_sha:0:12} offsite=$offsite rid=$rid"
echo "$dest/$base.dump"
