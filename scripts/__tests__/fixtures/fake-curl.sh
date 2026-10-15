#!/bin/bash
# Fake curl for scripts/__tests__/monitor.test.mjs: local health answers from $FAKE/health (default
# OK); the Access probe (any call with -D) answers the headers in $FAKE/access-headers
# (UNRESOLVED -> exit 6 with no output).
F="${FAKE:?FAKE dir required}"
case "$*" in
  *127.0.0.1:3961/health*)
    if [ "$(cat "$F/health" 2>/dev/null)" = DOWN ]; then exit 7; fi   # like curl's "failed to connect"
    cat "$F/health" 2>/dev/null || printf 'OK' ;;
  *" -D "*)
    if [ "$(cat "$F/access-headers" 2>/dev/null)" = UNRESOLVED ]; then exit 6; fi   # like "could not resolve host"
    cat "$F/access-headers" 2>/dev/null || printf 'HTTP/2 302\r\nlocation: https://drn.cloudflareaccess.com/x\r\n' ;;
  *) exit 0 ;;
esac
