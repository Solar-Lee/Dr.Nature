#!/bin/bash
# [P12-11] Roll back to a previous image (deployment review C1, C4, C11).
#   drn-rollback.sh <old sha12>                              only when the ledger shows the new
#                                                            version never ran its migrations
#   drn-rollback.sh <old sha12> --restore <pre dump> [--accept-loss <code>]
# --restore order: ledger sha256 of the pre dump -> C11 fingerprint gate (any write after the
# "deployed" entry is refused with exit 4 unless --accept-loss <first 12 chars of the current
# fingerprint>, which only Aki may hand over) -> pre-rollback dump (never auto-deleted) ->
# non-destructive restore drill of the pre dump -> drn-maint stop -> dropdb --force, createdb,
# pg_restore -1 -> retag -> up -> check-migrations against the old image -> drn-maint end ->
# list of merchant_trade_no created after the deploy (from the pre-rollback dump, for the ECPay
# back office). Nothing here ever runs prune, down -v, or volume rm.
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
bin="$drn_dir/bin"
old="${1:-}"; shift || true
[ -n "$old" ] || { echo "usage: drn-rollback.sh <old sha12> [--restore <pre dump>] [--accept-loss <code>]" >&2; exit 2; }
restore=""; accept=""
while [ $# -gt 0 ]; do
  case "$1" in
    --restore) restore="$2"; shift 2 ;;
    --accept-loss) accept="$2"; shift 2 ;;
    *) echo "drn-rollback: unknown argument $1" >&2; exit 2 ;;
  esac
done
fail() { echo "drn-rollback: $*" >&2; drn_log rollback "FAIL $*"; exit "${2:-1}"; }
image="drn-backend:$old"
"$drn_docker" image inspect -f '{{.Id}}' "$image" >/dev/null 2>&1 || fail "image $image not present"
ledger="$drn_logs/releases.log"
last="$(tail -n 1 "$ledger" 2>/dev/null || true)"
[ -n "$last" ] || fail "empty release ledger"
read -r _ action l_old l_new l_pre l_sha l_fp <<< "$last"
[ "$l_old" = "$old" ] || fail "ledger's previous version is $l_old, not $old"

if [ -z "$restore" ]; then
  # R1: image only. Allowed only when the new version's migrations never ran (ledger stopped at "deploy").
  [ "$action" = deploy ] || fail "last ledger entry is '$action': the new version ran migrations, use --restore"
  "$bin/drn-maint" stop "rollback $l_new-$old"
  "$drn_docker" tag "$image" drn-backend:current
  "$bin/drn-compose" up -d --wait --wait-timeout 600 || fail "up failed"
  [ "$(curl -s -m 10 http://127.0.0.1:3961/health)" = OK ] || fail "local /health failed"
  bash "$bin/drn-releases.sh" append rollback "$l_new" "$old" "$l_pre" "$l_sha" "$(drn_fingerprint)"
  "$bin/drn-maint" end
  drn_log rollback "ok image-only $l_new -> $old"
  exit 0
fi

[ -f "$restore" ] || fail "pre dump $restore not found"
[ "$(basename "$restore")" = "$l_pre" ] || fail "ledger names $l_pre, not $(basename "$restore")" 2
have_sha="$(shasum -a 256 "$restore" | cut -d' ' -f1)"
[ "$have_sha" = "$l_sha" ] || fail "sha256 of $restore does not match the ledger" 2

# C11 gate: compare the current fingerprint with the one recorded at the end of the deploy.
fp_now="$(drn_fingerprint)"
if [ "$action" = deployed ] && [ "$fp_now" != "$l_fp" ]; then
  if [ "$accept" != "${fp_now:0:12}" ]; then
    echo "drn-rollback: data was written after the deploy (fingerprint $l_fp -> $fp_now)." >&2
    echo "Restoring would DROP those writes. Table counts now:" >&2
    drn_pg_sql "select 'order',count(*) from \"order\" union all select 'payment',count(*) from payment union all select 'customer',count(*) from customer union all select 'fulfillment',count(*) from fulfillment" >&2 || true
    echo "Only with Aki's explicit approval: rerun with --accept-loss ${fp_now:0:12}" >&2
    drn_log rollback "REFUSED fingerprint gate $l_fp -> $fp_now"
    exit 4
  fi
  drn_log rollback "loss accepted by code ${fp_now:0:12}"
fi

bash "$bin/drn-lock.sh" acquire heavy || fail "heavy lock busy"
trap 'bash "$bin/drn-lock.sh" release heavy || true' EXIT
prer="$(bash "$bin/drn-backup.sh" pre-rollback)" || fail "pre-rollback dump failed"
bash "$bin/drn-lock.sh" release heavy
bash "$bin/drn-restore-check.sh" "$restore" --container drn-restore-check || fail "restore drill of $restore failed; not touching the live database"
bash "$bin/drn-lock.sh" acquire heavy || fail "heavy lock busy"

"$bin/drn-maint" stop "rollback-restore $l_new-$old"
"$drn_docker" exec drn-postgres sh -c 'dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"' || fail "dropdb/createdb failed (restore from $prer by hand)"
"$drn_docker" exec -i drn-postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl -1' < "$restore" || fail "pg_restore failed (pre-rollback dump: $prer)"
"$drn_docker" tag "$image" drn-backend:current
"$bin/drn-compose" up -d --wait --wait-timeout 600 || fail "up failed"
bash "$bin/drn-check-migrations.sh" --image "$image" || fail "migration check against $image failed"
[ "$(curl -s -m 10 http://127.0.0.1:3961/health)" = OK ] || fail "local /health failed"
bash "$bin/drn-releases.sh" append rollback-restore "$l_new" "$old" "$(basename "$prer")" "$(shasum -a 256 "$prer" | cut -d' ' -f1)" "$(drn_fingerprint)"
"$bin/drn-maint" end

# Reconciliation list: trades created after the deploy, from the pre-rollback dump.
echo "merchant_trade_no created after the deploy (check them in the ECPay back office):"
bash "$bin/drn-lock.sh" release heavy
bash "$bin/drn-restore-check.sh" "$prer" --container drn-restore-check >/dev/null 2>&1 || true
drn_log rollback "ok restore $l_new -> $old from $(basename "$restore"); pre-rollback $(basename "$prer")"
echo "(list the trades with: pg_restore -t payment_session from $prer into a scratch database; see docs/ops/deploy-backend.md)"
