#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
cd_ops_root
require_ops_runtime

WINDOW="${LOG_SCAN_WINDOW:-10m}"
SERVER_SERVICE="$(resolve_service SERVER_SERVICE server)"
LIVEKIT_SERVICE="$(resolve_service LIVEKIT_SERVICE livekit)"

server_logs="$(compose logs --since "$WINDOW" "$SERVER_SERVICE" 2>/dev/null || true)"
livekit_logs="$(compose logs --since "$WINDOW" "$LIVEKIT_SERVICE" 2>/dev/null || true)"

critical_pattern='(ERROR|panic|panicked|Failed to run migrations|VersionMismatch|ParseIntError|must be a number|database.*disconnected|Failed to connect to database|Failed to connect to Redis|Redis connection failed|Redis JWT blacklist check failed|Attachment service initialization failed|Failed to create attachment directory|Failed to read attachment|Failed to write attachment|WebSocket.*failed|Broadcast receiver lagged|LiveKit.*failed|Failed to sign LiveKit token|oauth.*failed)'
if [[ "${LOG_SCAN_INCLUDE_AUTH_ABUSE:-}" == "1" ]]; then
  critical_pattern="${critical_pattern}|(turnstile.*failed|rate limit|too many.*requests)"
fi

if grep -Eiq "$critical_pattern" <<<"$server_logs"$'\n'"$livekit_logs"; then
  echo "Critical log pattern detected in last $WINDOW"
  grep -Ein "$critical_pattern" <<<"$server_logs"$'\n'"$livekit_logs" | tail -50 | redact_logs
  exit 1
fi

echo "Critical log scan passed"
