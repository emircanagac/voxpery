#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

API_URL="${API_HEALTH_URL:-http://127.0.0.1:3001/health}"
WEB_URL="${WEB_HEALTH_URL:-http://127.0.0.1:${WEB_PORT:-5173}}"

services=(postgres redis livekit server web)
for svc in "${services[@]}"; do
  if ! docker compose ps --services --filter "status=running" | grep -qx "$svc"; then
    echo "Service not running: $svc"
    exit 1
  fi
done

api_body="$(curl -fsS "$API_URL")"
if ! grep -q '"status":"ok"' <<<"$api_body"; then
  echo "API health is not ok: $api_body"
  exit 1
fi

curl -fsSI "$WEB_URL" >/dev/null

echo "Stack healthcheck passed"
