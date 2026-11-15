#!/bin/sh
# Starts Redis with the append-only file, so sessions, the token blacklist and rate-limit
# state survive a crash. Arguments are passed on to redis-server.
#
# Redis ignores an existing dump.rdb when it is first started with the append-only file and
# would come up empty. On that first start this script loads the snapshot into a private
# instance (no network port), lets Redis write the append-only file from it, and only then
# starts the real server. It runs once: afterwards the append-only directory exists.

set -eu

data_dir=/data
socket=/tmp/voxpery-redis-migrate.sock

cli() {
  redis-cli -s "$socket" "$@"
}

wait_for() {
  # wait_for <seconds> <command...>: succeeds as soon as the command does.
  remaining="$1"
  shift
  while [ "$remaining" -gt 0 ]; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    remaining=$((remaining - 1))
  done
  return 1
}

snapshot_is_loaded() {
  [ "$(cli ping 2>/dev/null)" = "PONG" ]
}

append_only_file_is_written() {
  info="$(cli info persistence | tr -d '\r')"
  echo "$info" | grep -q '^aof_enabled:1$' \
    && echo "$info" | grep -q '^aof_rewrite_in_progress:0$' \
    && echo "$info" | grep -q '^aof_rewrite_scheduled:0$' \
    && echo "$info" | grep -q '^aof_last_bgrewrite_status:ok$'
}

instance_is_gone() {
  ! cli ping
}

if [ -f "$data_dir/dump.rdb" ] && [ ! -d "$data_dir/appendonlydir" ]; then
  echo "voxpery: converting the existing Redis snapshot to the append-only file"
  docker-entrypoint.sh redis-server --port 0 --unixsocket "$socket" --unixsocketperm 777 \
    --dir "$data_dir" --appendonly no --daemonize yes

  if wait_for 120 snapshot_is_loaded \
    && cli config set appendonly yes >/dev/null \
    && wait_for 300 append_only_file_is_written; then
    cli shutdown >/dev/null 2>&1 || true
    wait_for 60 instance_is_gone || { echo "voxpery: the conversion instance did not stop" >&2; exit 1; }
    echo "voxpery: conversion finished"
  else
    # Leave nothing half-written, so the next start tries again instead of starting empty.
    cli shutdown nosave >/dev/null 2>&1 || true
    wait_for 60 instance_is_gone || true
    rm -rf "$data_dir/appendonlydir"
    echo "voxpery: converting the Redis snapshot failed; Redis was not started" >&2
    exit 1
  fi
fi

exec docker-entrypoint.sh redis-server "$@" --appendonly yes --appendfsync everysec
