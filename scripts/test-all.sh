#!/usr/bin/env bash
# Single test entry point for local runs and CI.
# - Finds test files by glob, never by a hand-kept list.
# - Judges each suite by its exit code, never by its output text.
# - Any failing suite fails the whole run; the first error line of each failure is printed.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

failed=()

run_suite() {
  local name="$1"; shift
  local log
  log="$(mktemp)"
  echo "▶ $name"
  "$@" >"$log" 2>&1
  local code=$?
  if [ "$code" -ne 0 ]; then
    failed+=("$name")
    echo "✖ $name (exit $code). First error:"
    grep -m1 -iE 'error|fail|not ok|cannot|exception' "$log" || head -5 "$log"
  else
    echo "✔ $name"
  fi
  rm -f "$log"
}

# 1. Node built-in tests for repo scripts (glob, so new files are picked up automatically).
shopt -s nullglob globstar
script_tests=(scripts/**/__tests__/*.test.mjs)
if [ "${#script_tests[@]}" -gt 0 ]; then
  run_suite "scripts (${#script_tests[@]} files)" node --test "${script_tests[@]}"
fi

# 2. Workspace packages that define a "test" script (added as apps/packages land).
if [ -f pnpm-workspace.yaml ]; then
  for pkg in apps/*/package.json packages/*/package.json; do
    dir="$(dirname "$pkg")"
    if node -e "process.exit(require('./$pkg').scripts?.test ? 0 : 1)"; then
      run_suite "$dir" pnpm --dir "$dir" test
    fi
  done
fi

# 2b. Backend (Medusa): typecheck, Medusa lint rules, and HTTP integration tests.
#     Integration tests need the dev Postgres (infra/docker-compose.dev.yml). If it is not
#     reachable the suite FAILS rather than being skipped, so a green run always means the
#     tests actually executed.
if [ -f apps/backend/package.json ]; then
  run_suite "backend:typecheck" pnpm --dir apps/backend exec tsc --noEmit -p tsconfig.json
  run_suite "backend:lint" pnpm --dir apps/backend run lint
  if compgen -G "apps/backend/integration-tests/http/*.spec.ts" >/dev/null; then
    if nc -z localhost 55432 >/dev/null 2>&1; then
      run_suite "backend:integration:http" bash -c 'cd apps/backend && ../../infra/test-env.sh pnpm run test:integration:http'
    else
      failed+=("backend:integration:http")
      echo "✖ backend:integration:http — dev Postgres not reachable on localhost:55432."
      echo "  Start it: docker compose -f infra/docker-compose.dev.yml up -d"
    fi
  fi
fi

# 3. Compliance scan of customer-facing copy.
run_suite "claims-lint" node scripts/claims-lint.mjs

# 4. Backend copy of the product master data must match content/products/catalog.json.
run_suite "catalog-sync" node scripts/sync-catalog.mjs --check

# 5. Env var names must come from the docs/ENV.md whitelist.
run_suite "env-names" node scripts/check-env-names.mjs

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "ALL PASSED"
