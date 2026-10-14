#!/bin/bash
# Fake drn-docker for scripts/__tests__/*.test.mjs: logs every call to $FAKE/calls.log and answers
# from files in $FAKE. Never talks to Docker. Any command naming a container that contains "nope"
# fails like a missing container.
F="${FAKE:?FAKE dir required}"
echo "$*" >> "$F/calls.log"
all="$*"
last="${*: -1}"
case "$all" in *nope*) echo "Error: No such container" >&2; exit 1 ;; esac
case "$all" in
  "exec "*"pg_dumpall"*) echo "-- fake globals"; exit 0 ;;
  "exec "*"pg_dump "*) cat "$F/dump" 2>/dev/null || printf 'PGDMP-fake'; exit 0 ;;
  "exec -i "*"pg_restore --list"*) cat >/dev/null; cat "$F/toc" 2>/dev/null; exit 0 ;;
  "exec -i "*"pg_restore "*) cat >/dev/null; exit "$(cat "$F/restore-exit" 2>/dev/null || echo 0)" ;;
  "exec "*"pg_isready"*) exit "$(cat "$F/ready-exit" 2>/dev/null || echo 0)" ;;
  "exec "*"redis-cli ping"*) cat "$F/redis-ping" 2>/dev/null || echo PONG; exit 0 ;;
  "exec "*"redis-cli info"*) cat "$F/redis-info" 2>/dev/null || echo "aof_last_write_status:ok"; exit 0 ;;
  "exec "*" df "*) cat "$F/df" 2>/dev/null || printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/x 100 10 90 10%% /var/lib/postgresql/data\n'; exit 0 ;;
  "exec -i "*"psql"*)
    sql="$(cat)"
    container="$3"
    case "$sql" in
      *"drn:anchors"*) cat "$F/anchors-$container" 2>/dev/null || cat "$F/anchors" 2>/dev/null || echo "0|0|0|0|0|0|0" ;;
      *"drn:fingerprint"*) cat "$F/fingerprint-rows" 2>/dev/null || echo "order|0|" ;;
      *"finished_at is null"*) cat "$F/unfinished" 2>/dev/null || echo 0 ;;
      *"finished_at is not null"*) cat "$F/finished" 2>/dev/null ;;
      *) cat "$F/sql-rows" 2>/dev/null ;;
    esac
    exit 0 ;;
  "run -d "*) echo "fakecontainerid"; exit "$(cat "$F/run-d-exit" 2>/dev/null || echo 0)" ;;
  "run --rm --network none -v "*" tar "*) tar -C "$F/uploads" -cf - . | gzip -c; exit 0 ;;  # bsdtar -z pads after gzip; busybox tar in the image does not
  "stop "*) exit 0 ;;
  "tag "*) echo "$3" > "$F/image-drn-backend:current.tagged"; cp "$F/image-$2" "$F/image-drn-backend:current" 2>/dev/null || true; exit 0 ;;
  "exec "*"dropdb "*) exit "$(cat "$F/dropdb-exit" 2>/dev/null || echo 0)" ;;
esac
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
      *".Image}}"*) cat "$F/image-of-$last" 2>/dev/null || echo "sha256:running" ;;
      *) echo "" ;;
    esac ;;
  "run --rm") cat "$F/run-out" 2>/dev/null; exit "$(cat "$F/run-exit" 2>/dev/null || echo 0)" ;;
  "exec "*) exit "$(cat "$F/exec-exit" 2>/dev/null || echo 0)" ;;
  *) exit 0 ;;
esac
