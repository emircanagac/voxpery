#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

WINDOW="${LOG_SCAN_WINDOW:-10m}"

server_logs="$(docker compose logs --since "$WINDOW" server 2>/dev/null || true)"
livekit_logs="$(docker compose logs --since "$WINDOW" livekit 2>/dev/null || true)"

critical_pattern='(ERROR|panic|database.*disconnected|Redis connection failed|WebSocket.*failed|LiveKit.*failed|oauth.*failed|turnstile.*failed)'

if grep -Eiq "$critical_pattern" <<<"$server_logs"$'\n'"$livekit_logs"; then
  echo "Critical log pattern detected in last $WINDOW"
  exit 1
fi

echo "Critical log scan passed"
