#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
cd_ops_root
require_ops_runtime
require_command curl

API_URL="${API_HEALTH_URL:-http://127.0.0.1:3001/health}"
WEB_URL="${WEB_HEALTH_URL:-http://127.0.0.1:${WEB_PORT:-5173}/healthz}"
TIMEOUT_SECS="${HEALTHCHECK_TIMEOUT_SECS:-5}"
REDIS_MEMORY_WARN_PERCENT="${REDIS_MEMORY_WARN_PERCENT:-80}"
REDIS_MEMORY_CRITICAL_PERCENT="${REDIS_MEMORY_CRITICAL_PERCENT:-90}"

POSTGRES_SERVICE="$(resolve_service POSTGRES_SERVICE postgres db)"
REDIS_SERVICE="$(resolve_service REDIS_SERVICE redis)"
LIVEKIT_SERVICE="$(resolve_service LIVEKIT_SERVICE livekit)"
SERVER_SERVICE="$(resolve_service SERVER_SERVICE server)"
WEB_SERVICE="$(resolve_service WEB_SERVICE web)"

services=("$POSTGRES_SERVICE" "$REDIS_SERVICE" "$LIVEKIT_SERVICE" "$SERVER_SERVICE" "$WEB_SERVICE")
for svc in "${services[@]}"; do
  require_running_service "$svc"
done

api_body="$(curl -fsS --max-time "$TIMEOUT_SECS" "$API_URL")"
if ! grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"$api_body"; then
  die "API health is not ok: $api_body"
fi

if ! compose_exec "$POSTGRES_SERVICE" sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null; then
  die "PostgreSQL readiness check failed"
fi

if ! compose_exec "$REDIS_SERVICE" redis-cli ping | grep -qx "PONG"; then
  die "Redis readiness check failed"
fi

redis_memory="$(compose_exec "$REDIS_SERVICE" redis-cli info memory | tr -d '\r')"
redis_used="$(awk -F: '$1 == "used_memory" { print $2 }' <<<"$redis_memory")"
redis_limit="$(awk -F: '$1 == "maxmemory" { print $2 }' <<<"$redis_memory")"
if [[ "${redis_limit:-0}" -gt 0 ]]; then
  redis_percent=$((redis_used * 100 / redis_limit))
  if ((redis_percent >= REDIS_MEMORY_CRITICAL_PERCENT)); then
    die "Redis memory is at ${redis_percent}% of maxmemory"
  fi
  if ((redis_percent >= REDIS_MEMORY_WARN_PERCENT)); then
    echo "Warning: Redis memory is at ${redis_percent}% of maxmemory"
  fi
fi

if ! compose_exec "$SERVER_SERVICE" sh -lc 'test -d "${ATTACHMENTS_LOCAL_DIR:-/home/voxpery/attachments}" && test -w "${ATTACHMENTS_LOCAL_DIR:-/home/voxpery/attachments}"'; then
  die "Attachment storage directory is missing or not writable"
fi

curl -fsS --max-time "$TIMEOUT_SECS" "$WEB_URL" >/dev/null

echo "Stack healthcheck passed"
