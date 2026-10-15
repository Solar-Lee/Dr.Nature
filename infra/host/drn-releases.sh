#!/bin/bash
# [P12-18] Release ledger logs/releases.log (deployment review C1). One line per action:
#   <ts> <action> <old-sha> <new-sha> <pre-dump-file|-> <pre-sha256|-> <fingerprint|->
#   drn-releases.sh first <sha>                                   first start (no previous)
#   drn-releases.sh append <action> <old> <new> <pre> <sha256> <fp>
#   drn-releases.sh last                                          prints the last line
#   drn-releases.sh verify-current                                image Id of drn-backend:current
#                                                                 == Id of drn-backend:<last new sha>
set -euo pipefail
# shellcheck disable=SC1091
. "$HOME/drn/bin/drn-lib.sh"
install -d -m 700 "$drn_logs"
ledger="$drn_logs/releases.log"
case "${1:-}" in
  first)
    [ -n "${2:-}" ] || { echo "usage: drn-releases.sh first <sha>" >&2; exit 2; }
    [ ! -s "$ledger" ] || { echo "drn-releases: ledger already has entries" >&2; exit 1; }
    printf '%s first - %s - - -\n' "$(drn_now)" "$2" >> "$ledger"; chmod 600 "$ledger"
    ;;
  append)
    [ $# -eq 7 ] || { echo "usage: drn-releases.sh append <action> <old> <new> <pre> <sha256> <fp>" >&2; exit 2; }
    printf '%s %s %s %s %s %s %s\n' "$(drn_now)" "$2" "$3" "$4" "$5" "$6" "$7" >> "$ledger"
    ;;
  last) tail -n 1 "$ledger" 2>/dev/null || { echo "drn-releases: empty ledger" >&2; exit 1; } ;;
  verify-current)
    last_sha="$(tail -n 1 "$ledger" 2>/dev/null | awk '{print $4}')"
    [ -n "$last_sha" ] || { echo "drn-releases: empty ledger" >&2; exit 1; }
    cur="$("$drn_docker" image inspect -f '{{.Id}}' drn-backend:current 2>/dev/null || true)"
    want="$("$drn_docker" image inspect -f '{{.Id}}' "drn-backend:$last_sha" 2>/dev/null || true)"
    if [ -z "$cur" ] || [ "$cur" != "$want" ]; then
      echo "drn-releases: drn-backend:current ($cur) != drn-backend:$last_sha ($want)" >&2; exit 1
    fi
    echo "current=$last_sha"
    ;;
  *) echo "usage: drn-releases.sh first|append|last|verify-current" >&2; exit 2 ;;
esac
