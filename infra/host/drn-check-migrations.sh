#!/bin/bash
# [P12-18] Verifies the two-step migration really finished (Medusa 2.21.2 `db:migrate` returns 0
# even when a migration script fails). Expected drn-* scripts are read FROM THE IMAGE, finished
# ones from script_migrations (script_name, finished_at; framework run-migration-scripts.js).
#   drn-check-migrations.sh [--image drn-backend:current] [--pg-container drn-postgres]
# Prints `unfinished=N drn=<finished>/<expected>`; exit 0 only when N=0 and the sets are equal.
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
image="drn-backend:current"; pg="drn-postgres"
while [ $# -gt 0 ]; do
  case "$1" in
    --image) image="$2"; shift 2 ;;
    --pg-container) pg="$2"; shift 2 ;;
    *) echo "drn-check-migrations: unknown argument $1" >&2; exit 2 ;;
  esac
done
expected="$("$drn_docker" run --rm --entrypoint sh "$image" -c 'ls /app/.medusa/server/src/migration-scripts/' | grep -E '^drn-.*\.js$' | sed 's/\.js$//' | sort -u)"
[ -n "$expected" ] || { echo "drn-check-migrations: no drn-* scripts found in $image" >&2; exit 1; }
unfinished="$(drn_pg_sql "select count(*) from script_migrations where finished_at is null" "$pg")"
finished="$(drn_pg_sql "select regexp_replace(script_name, '\.(js|ts)$', '') from script_migrations where finished_at is not null and script_name like 'drn-%' order by 1" "$pg" | sort -u)"
n_expected="$(printf '%s\n' "$expected" | grep -c . || true)"
n_finished="$(printf '%s\n' "$finished" | grep -c . || true)"
echo "unfinished=$unfinished drn=$n_finished/$n_expected"
if [ "$unfinished" != "0" ] || [ "$expected" != "$finished" ]; then
  echo "expected: $(printf '%s ' $expected)"; echo "finished: $(printf '%s ' $finished)"
  exit 1
fi
