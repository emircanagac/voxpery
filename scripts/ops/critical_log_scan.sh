#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

WINDOW="${LOG_SCAN_WINDOW:-10m}"

server_logs="$(docker compose logs --since "$WINDOW" server 2>/dev/null || true)"
livekit_logs="$(docker compose logs --since "$WINDOW" livekit 2>/dev/null || true)"

critical_pattern='(ERROR|panic|panicked|Failed to run migrations|VersionMismatch|ParseIntError|must be a number|database.*disconnected|Failed to connect to database|Failed to connect to Redis|Redis connection failed|Redis JWT blacklist check failed|Attachment service initialization failed|Failed to create attachment directory|Failed to read attachment|Failed to write attachment|WebSocket.*failed|Broadcast receiver lagged|LiveKit.*failed|Failed to sign LiveKit token|oauth.*failed|turnstile.*failed)'

if grep -Eiq "$critical_pattern" <<<"$server_logs"$'\n'"$livekit_logs"; then
  echo "Critical log pattern detected in last $WINDOW"
  grep -Ein "$critical_pattern" <<<"$server_logs"$'\n'"$livekit_logs" | tail -50
  exit 1
fi

echo "Critical log scan passed"
