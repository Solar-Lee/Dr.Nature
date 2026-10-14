#!/bin/bash
# Fake curl for scripts/__tests__/monitor.test.mjs: local health answers from $FAKE/health (default
# OK); the Access probe (any call with -D) answers the headers in $FAKE/access-headers.
F="${FAKE:?FAKE dir required}"
case "$*" in
  *127.0.0.1:3961/health*) cat "$F/health" 2>/dev/null || printf 'OK' ;;
  *" -D "*) cat "$F/access-headers" 2>/dev/null || printf 'HTTP/2 302\r\nlocation: https://drn.cloudflareaccess.com/x\r\n' ;;
  *) exit 0 ;;
esac
