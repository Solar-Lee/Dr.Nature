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

# 3. Compliance scan of customer-facing copy.
run_suite "claims-lint" node scripts/claims-lint.mjs

# 4. Env var names must come from the docs/ENV.md whitelist.
run_suite "env-names" node scripts/check-env-names.mjs

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "ALL PASSED"
