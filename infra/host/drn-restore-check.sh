#!/bin/bash
# [P12-21] Weekly restore drill (Sunday 05:00 Asia/Taipei by drn.restore-check): restores a backup
# into a throwaway Postgres (same image digest as drn-postgres, --network none, 1 GiB, trust auth
# inside the isolated container) and compares anchors with the backup's manifest, so an "empty but
# valid" restore cannot pass (deployment review minor 37).
#   drn-restore-check.sh [<dump>] [--container <name>] [--list-trades-since <ISO-8601 UTC>]
# --list-trades-since additionally prints, after a passing drill, every ECPay MerchantTradeNo whose
# payment session was created at or after that time (used by drn-rollback.sh to reconcile trades
# that a restore dropped; lines "trade <created_at> <merchant_trade_no> <amount>").
# Default dump: the newest daily one. Pass: product count, public table count and finished drn-*
# scripts equal the manifest; order/customer/payment lie between the before/after counts; no
# unfinished migration script; the uploads archive passes gzip -t with >= the manifest's file count.
# One JSON line per drill goes to ~/drn/logs/restore-drills.log (keep 5 years: digital-economy PII
# rules art. 16, docs/research/mac-mini-deploy-2026-10-13.md); Healthchecks gets pass/fail only.
set -euo pipefail
umask 077
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
drn_load_host_env

dump=""; name="drn-restore-check"; trades_since=""
while [ $# -gt 0 ]; do
  case "$1" in
    --container) name="$2"; shift 2 ;;
    --list-trades-since) trades_since="$2"; shift 2 ;;
    -*) echo "drn-restore-check: unknown option $1" >&2; exit 2 ;;
    *) dump="$1"; shift ;;
  esac
done
if [ -z "$dump" ]; then dump="$(ls -1 "$drn_dir"/backups/daily/drn-*.dump 2>/dev/null | sort | tail -n 1 || true)"; fi
[ -n "$dump" ] && [ -f "$dump" ] || { echo "drn-restore-check: no dump found" >&2; hc_ping drill fail "no dump"; exit 1; }
manifest="${dump%.dump}.manifest"
uploads="${dump%.dump}.uploads.tar.gz"

result="fail"; anchors_ok="false"; detail=""
record() {
  install -d -m 700 "$drn_logs"
  local f="$drn_logs/restore-drills.log"
  [ -e "$f" ] || { : > "$f"; chmod 600 "$f"; }
  printf '{"ts":"%s","dump":"%s","result":"%s","anchors_ok":%s,"detail":"%s"}\n' \
    "$(drn_now)" "$(basename "$dump")" "$result" "$anchors_ok" "$detail" >> "$f"
}
stop_container() { "$drn_docker" stop "$name" >/dev/null 2>&1 || true; }

bash "$drn_dir/bin/drn-lock.sh" acquire heavy || { detail="heavy lock busy"; record; hc_ping drill fail "$detail"; exit 1; }
trap 'stop_container; bash "$drn_dir/bin/drn-lock.sh" release heavy || true' EXIT

finish() {
  record
  if [ "$result" = pass ]; then hc_ping drill "" "pass $(basename "$dump")"; exit 0; fi
  hc_ping drill fail "$detail"; exit 1
}

if [ ! -f "$manifest" ]; then detail="manifest missing"; finish; fi

"$drn_docker" run -d --rm --name "$name" --network none --memory 1g \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=drn -e POSTGRES_DB=drn_restore \
  "$drn_pg_image" >/dev/null || { detail="restore container did not start"; finish; }

ready=0
for _ in $(seq 1 60); do
  if "$drn_docker" exec "$name" pg_isready -h 127.0.0.1 -U drn -d drn_restore >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { detail="restore postgres not ready"; finish; }

if ! "$drn_docker" exec -i "$name" pg_restore -U drn -d drn_restore --no-owner --no-acl -1 < "$dump" >/dev/null; then
  detail="pg_restore failed"; finish
fi

IFS='|' read -r r_product r_tables r_drn r_unfinished r_order r_customer r_payment <<< "$(drn_anchors "$name")"
IFS='|' read -r b_product b_tables b_drn _ b_order b_customer b_payment <<< "$(drn_manifest_get "$manifest" anchors_before)"
IFS='|' read -r a_product _ _ _ a_order a_customer a_payment <<< "$(drn_manifest_get "$manifest" anchors_after)"
between() { [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]; }
problems=()
[ "$r_product" = "$b_product" ] && [ "$r_product" = "$a_product" ] || problems+=("product $r_product!=$b_product")
[ "$r_tables" = "$b_tables" ] || problems+=("tables $r_tables!=$b_tables")
[ "$r_drn" = "$b_drn" ] || problems+=("drn-scripts $r_drn!=$b_drn")
[ "$r_unfinished" = 0 ] || problems+=("unfinished $r_unfinished")
between "$r_order" "$b_order" "$a_order" || problems+=("order $r_order")
between "$r_customer" "$b_customer" "$a_customer" || problems+=("customer $r_customer")
between "$r_payment" "$b_payment" "$a_payment" || problems+=("payment $r_payment")
want_files="$(drn_manifest_get "$manifest" uploads_files)"
if [ "$want_files" != "-" ] && [ -n "$want_files" ]; then
  if ! gzip -t "$uploads" 2>/dev/null; then problems+=("uploads archive broken")
  else
    have_files="$(tar -tzf "$uploads" | grep -vc '/$' || true)"
    [ "$have_files" -ge "$want_files" ] || problems+=("uploads $have_files<$want_files")
  fi
fi
if [ "${#problems[@]}" -eq 0 ]; then
  result="pass"; anchors_ok="true"; detail="product=$r_product tables=$r_tables drn=$r_drn"
  if [ -n "$trades_since" ]; then
    case "$trades_since" in *"'"*) echo "drn-restore-check: bad timestamp" >&2; exit 2 ;; esac
    drn_pg_sql "/* drn:trades */ select 'trade', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), data->>'merchant_trade_no', coalesce(data->>'amount','') from payment_session where provider_id = 'pp_ecpay_ecpay' and created_at >= '$trades_since'::timestamptz order by created_at" "$name" | tr '|' ' '
  fi
else
  detail="${problems[*]}"
fi
finish
