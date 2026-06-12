#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
cd_ops_root
require_ops_runtime

umask 077

BACKUP_DIR="${BACKUP_DIR:-$ops_root_dir/backups/postgres}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_NAME="${POSTGRES_DB:-voxpery}"
DB_USER="${POSTGRES_USER:-voxpery}"
BACKUP_LABEL="${BACKUP_LABEL:-}"
SAFE_LABEL=""
if [[ -n "$BACKUP_LABEL" ]]; then
  SAFE_LABEL="_$(tr -cd '[:alnum:]_.-' <<<"$BACKUP_LABEL" | cut -c1-48)"
fi
OUT_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}${SAFE_LABEL}.sql.gz"
TMP_FILE="$OUT_FILE.tmp"
POSTGRES_SERVICE="$(resolve_service POSTGRES_SERVICE postgres db)"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"

require_running_service "$POSTGRES_SERVICE"
compose_exec "$POSTGRES_SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

if [[ "${BACKUP_DRY_RUN:-}" == "1" ]]; then
  info "Dry run passed. Backup would be written to: $OUT_FILE"
  exit 0
fi

compose_exec "$POSTGRES_SERVICE" pg_dump \
  --format=plain \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -U "$DB_USER" "$DB_NAME" | gzip -9 > "$TMP_FILE"

gzip -t "$TMP_FILE"
mv "$TMP_FILE" "$OUT_FILE"

echo "Backup created: $OUT_FILE"
