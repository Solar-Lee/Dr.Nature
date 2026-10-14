#!/bin/bash
# [P12-11] Upgrade to a verified image (deployment review C1, C4). Usage, from any directory:
#   drn-deploy.sh <sha12>
# Steps (any failure stops, prints the rollback command and KEEPS the maintenance flag):
#  1. preflight: image-ok-<sha>, heavy lock, >= 40 GB free, 4 core containers healthy, no
#     maintenance flag, drn-backend:current == last ledger entry
#  2. drn-maint stop <old>-<new> (alertscan, stop worker then backend)
#  3. pre dump (DB + globals) with sha256 and fingerprint -> ledger "deploy"
#  4. retag drn-backend:current -> <sha>
#  5. two-step migration in one-off containers (drn-migrate)
#  6. drn-check-migrations against the new image
#  7. drn-compose up -d --wait
#  8. running containers use the new image id
#  9. smoke: local /health
# 10. ledger "deployed" with the post-deploy fingerprint
# 11. drn-maint end
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
sha="${1:-}"
[ -n "$sha" ] || { echo "usage: drn-deploy.sh <sha12>" >&2; exit 2; }
new="drn-backend:$sha"
bin="$drn_dir/bin"

fail() { echo "drn-deploy: $*" >&2; drn_log deploy "FAIL $*"; exit 1; }
[ -e "$drn_state/image-ok-$sha" ] || fail "no image-ok-$sha (run drn-build.sh first)"
! drn_maint_active || fail "maintenance flag present ($(drn_maint_reason)); finish it first"
bash "$bin/drn-lock.sh" acquire heavy || fail "heavy lock busy"
trap 'bash "$bin/drn-lock.sh" release heavy || true' EXIT
free_gb="$(df -Pk "$HOME" | awk 'NR==2 {print int($4/1048576)}')"
min_free="$(cat "$drn_state/deploy-min-free-gb" 2>/dev/null || echo 40)"   # 40 GB unless lowered on purpose
[ "$free_gb" -ge "$min_free" ] || fail "only ${free_gb} GB free (need $min_free)"
for c in drn-backend drn-worker drn-postgres drn-redis; do
  [ "$(drn_health "$c")" = healthy ] || fail "$c is not healthy"
done
old="$(bash "$bin/drn-releases.sh" verify-current | sed 's/^current=//')" || fail "drn-backend:current does not match the release ledger"
[ "$old" != "$sha" ] || fail "$sha is already current"

"$bin/drn-maint" stop "deploy $old-$sha"
echo "rollback if needed: drn-rollback.sh $old   (after the pre dump: --restore <pre file>)"

pre="$(bash "$bin/drn-backup.sh" pre "$old-$sha")" || fail "pre dump failed"
pre_sha="$(shasum -a 256 "$pre" | cut -d' ' -f1)"
fp_before="$(drn_fingerprint)"
bash "$bin/drn-releases.sh" append deploy "$old" "$sha" "$(basename "$pre")" "$pre_sha" "$fp_before"

"$drn_docker" tag "$new" drn-backend:current
drn_log deploy "retag current -> $sha"
echo "rollback if needed: drn-rollback.sh $old --restore $pre"

"$bin/drn-compose" run --rm --no-deps -T --name drn-migrate drn-backend /app/node_modules/.bin/medusa db:migrate --skip-scripts --execute-safe-links --execute-safe-search || fail "db:migrate failed"
"$bin/drn-compose" run --rm --no-deps -T --name drn-migrate drn-backend /app/node_modules/.bin/medusa db:migrate:scripts || fail "db:migrate:scripts failed"
bash "$bin/drn-check-migrations.sh" --image "$new" || fail "migration check failed"

"$bin/drn-compose" up -d --wait --wait-timeout 600 || fail "up failed"
want="$("$drn_docker" image inspect -f '{{.Id}}' "$new")"
for c in drn-backend drn-worker; do
  have="$("$drn_docker" inspect -f '{{.Image}}' "$c")"
  [ "$have" = "$want" ] || fail "$c runs $have, expected $want"
done
[ "$(curl -s -m 10 http://127.0.0.1:3961/health)" = OK ] || fail "local /health failed after up"

fp_after="$(drn_fingerprint)"
bash "$bin/drn-releases.sh" append deployed "$old" "$sha" "$(basename "$pre")" "$pre_sha" "$fp_after"
"$bin/drn-maint" end || fail "drn-maint end failed"
drn_log deploy "ok $old -> $sha"
echo "deployed $sha (previous $old, pre dump $(basename "$pre"))"
