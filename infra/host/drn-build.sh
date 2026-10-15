#!/bin/bash
# [P12-03] Builds drn-backend:<git sha 12> on the Mac mini and verifies it (deployment review C1,
# C7). Run by CODE from the repo root on a CLEAN worktree:
#   bash infra/host/drn-build.sh
# Never tags drn-backend:current (only the first start, drn-deploy.sh and drn-rollback.sh do).
# Takes the heavy lock (shared with the restore drill and deploys), samples `docker stats` every
# 5 s into ~/drn/logs/build-mem-<sha>.log, and writes ~/drn/state/image-ok-<sha> only when every
# check passes:
#   architecture arm64; @medusajs/medusa 2.21.2; every /app/node_modules/.pnpm entry is a locked
#   name@version (scripts/check-image-deps.mjs); the admin bundle exists and has no
#   localhost:9000; /app/.medusa/server/static is owned by node; the public drill script and the
#   job heartbeat are compiled into the image; drn-backend:current did not move.
# Prints the sha on the last line. Exit 1 on any failure.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo"
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
install -d -m 700 "$drn_logs" "$drn_state"

if [ -n "$(git status --porcelain)" ]; then
  echo "drn-build: worktree not clean; commit first" >&2
  exit 1
fi
sha="$(git rev-parse --short=12 HEAD)"
tag="drn-backend:$sha"

bash "$drn_dir/bin/drn-lock.sh" acquire heavy || { echo "drn-build: heavy lock busy" >&2; exit 1; }
sampler=""
cleanup() {
  [ -n "$sampler" ] && kill "$sampler" 2>/dev/null || true
  bash "$drn_dir/bin/drn-lock.sh" release heavy || true
}
trap cleanup EXIT

current_before="$("$drn_docker" image inspect -f '{{.Id}}' drn-backend:current 2>/dev/null || echo none)"

memlog="$drn_logs/build-mem-$sha.log"
: > "$memlog"; chmod 600 "$memlog"
( while true; do
    "$drn_docker" stats --no-stream --format '{{.Name}} {{.MemUsage}}' 2>/dev/null | sed "s/^/$(date -u +%H:%M:%S) /" >> "$memlog" || true
    sleep 5
  done ) &
sampler=$!

echo "drn-build: building $tag"
"$drn_docker" build -f infra/backend.Dockerfile -t "$tag" .

fail() { echo "drn-build: CHECK FAILED: $*" >&2; exit 1; }
arch="$("$drn_docker" image inspect -f '{{.Architecture}}' "$tag")"
[ "$arch" = "arm64" ] || fail "architecture $arch"
medusa="$("$drn_docker" run --rm --network none --entrypoint node "$tag" -e "console.log(require('/app/node_modules/@medusajs/medusa/package.json').version)")"
[ "$medusa" = "2.21.2" ] || fail "medusa $medusa"
"$drn_docker" run --rm --network none --entrypoint ls "$tag" /app/node_modules/.pnpm | node scripts/check-image-deps.mjs || fail "image dependencies differ from pnpm-lock.yaml"
"$drn_docker" run --rm --network none --entrypoint sh "$tag" -c 'test -f /app/.medusa/server/public/admin/index.html && ! grep -rlq "localhost:9000" /app/.medusa/server/public/admin' || fail "admin bundle missing or points at localhost:9000"
owner="$("$drn_docker" run --rm --network none --entrypoint stat "$tag" -c %U /app/.medusa/server/static)"
[ "$owner" = "node" ] || fail "static owner $owner"
"$drn_docker" run --rm --network none --entrypoint sh "$tag" -c 'test -f /app/.medusa/server/src/scripts/ecpay-public-drill.js && test -f /app/.medusa/server/src/jobs/drn-job-heartbeat.js' || fail "drill script or job heartbeat missing from the image"
current_after="$("$drn_docker" image inspect -f '{{.Id}}' drn-backend:current 2>/dev/null || echo none)"
[ "$current_before" = "$current_after" ] || fail "drn-backend:current moved during the build"
[ -s "$memlog" ] || fail "no memory samples recorded"

: > "$drn_state/image-ok-$sha"
drn_log build "ok $sha arch=$arch medusa=$medusa"
echo "$sha"
