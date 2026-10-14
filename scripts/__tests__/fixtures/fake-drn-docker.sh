#!/bin/bash
# Fake drn-docker for scripts/__tests__/*.test.mjs: logs every call to $FAKE/calls.log and answers
# from files in $FAKE. Never talks to Docker.
F="${FAKE:?FAKE dir required}"
echo "$*" >> "$F/calls.log"
last="${*: -1}"
case "$1 $2" in
  "info "*|"info") exit 0 ;;
  "compose "*) exit "$(cat "$F/compose-exit" 2>/dev/null || echo 0)" ;;
  "logs "*) cat "$F/logs-$last" 2>/dev/null; exit 0 ;;
  "image inspect") cat "$F/image-$last" 2>/dev/null || exit 1 ;;
  "inspect -f")
    case "$3" in
      *Running*) cat "$F/running-$last" 2>/dev/null || cat "$F/running" 2>/dev/null || echo true ;;
      *Health*) cat "$F/health-$last" 2>/dev/null || cat "$F/health" 2>/dev/null || echo healthy ;;
      *StartedAt*) cat "$F/started-$last" 2>/dev/null || echo "2026-10-14T00:00:00.000000000Z" ;;
      *RestartCount*) cat "$F/restarts-$last" 2>/dev/null || echo "0 false" ;;
      *) echo "" ;;
    esac ;;
  "run --rm") cat "$F/run-out" 2>/dev/null; exit "$(cat "$F/run-exit" 2>/dev/null || echo 0)" ;;
  "exec -i")
    sql="$(cat)"
    case "$sql" in
      *"finished_at is null"*) cat "$F/unfinished" 2>/dev/null || echo 0 ;;
      *"finished_at is not null"*) cat "$F/finished" 2>/dev/null ;;
      *) cat "$F/sql-rows" 2>/dev/null ;;
    esac ;;
  "exec "*) exit "$(cat "$F/exec-exit" 2>/dev/null || echo 0)" ;;
  *) exit 0 ;;
esac
