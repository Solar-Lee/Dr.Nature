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
    # Every failing TAP subtest with its whole YAML block (node --test), then the log tail on CI,
    # where the local log file is not available afterwards.
    awk '/^not ok/{p=1} p{print} /^  \.\.\.$/{p=0}' "$log" | head -200
    if [ -n "${CI:-}" ]; then echo "--- last 40 lines of $name ---"; tail -40 "$log"; fi
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

# 2a. Storefront (Next.js static export, P12-26): typecheck and a full build; the build must
#     produce the 404 page and the three product pages, else the export is incomplete.
if [ -f apps/storefront/package.json ]; then
  run_suite "storefront:typecheck" pnpm --dir apps/storefront exec tsc --noEmit
  run_suite "storefront:build" bash -c 'pnpm --dir apps/storefront exec next build >/dev/null 2>&1 && test -f apps/storefront/out/404.html && test -f apps/storefront/out/products/calm/index.html'
fi

# 2b. Backend (Medusa): typecheck, Medusa lint rules, and HTTP integration tests.
#     Integration tests need the dev Postgres (infra/docker-compose.dev.yml). If it is not
#     reachable the suite FAILS rather than being skipped, so a green run always means the
#     tests actually executed.
if [ -f apps/backend/package.json ]; then
  run_suite "backend:typecheck" pnpm --dir apps/backend exec tsc --noEmit -p tsconfig.json
  run_suite "backend:lint" pnpm --dir apps/backend run lint
  if [ -n "$(find apps/backend/src -path '*/__tests__/*' -name '*.unit.spec.ts' -not -path '*/node_modules/*' | head -1)" ]; then
    run_suite "backend:unit" bash -c 'cd apps/backend && ../../infra/test-env.sh pnpm run test:unit'
  fi
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

# 6. [P11-02a] Storefront device matrix (Playwright, e2e/): 7 engine x device projects against the
#    export written by storefront:build (needs installed browsers; docs/ops/preview-storefront.md).
#    On CI it runs in the separate `e2e` job of .github/workflows/ci.yml, which installs them.
if [ -f e2e/package.json ] && [ -f apps/storefront/package.json ]; then
  if [ -n "${CI:-}" ]; then
    echo "↷ e2e:storefront-matrix runs in the CI e2e job"
  elif [[ " ${failed[*]:-} " == *" storefront:build "* ]]; then
    failed+=("e2e:storefront-matrix")
    echo "✖ e2e:storefront-matrix — storefront:build failed, so there is no export to test."
  else
    # Mac mini: browsers live under ~/drn (CLAUDE.md §1b), not in Playwright's default cache.
    if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d "$HOME/drn/pw-browsers" ]; then
      export PLAYWRIGHT_BROWSERS_PATH="$HOME/drn/pw-browsers"
    fi
    run_suite "e2e:storefront-matrix" pnpm --dir e2e exec playwright test
  fi
fi

# 7. [CC-07] Compliance scan of what visitors and LINE users actually read: the storefront copy, the
#    built HTML from storefront:build, and the LINE reply data. Only paths that exist are passed
#    (claims-lint skips a missing path silently, so it must never be the only argument).
claims_paths=()
for p in apps/storefront/lib apps/storefront/content apps/storefront/out apps/backend/src/data/line-replies.json; do
  if [ -e "$p" ]; then claims_paths+=("$p"); fi
done
if [ "${#claims_paths[@]}" -gt 0 ]; then
  run_suite "claims-lint:storefront (${#claims_paths[@]} paths)" node scripts/claims-lint.mjs "${claims_paths[@]}"
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "ALL PASSED"
