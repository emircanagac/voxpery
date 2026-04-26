#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_NAME="${POSTGRES_DB:-voxpery}"
DB_USER="${POSTGRES_USER:-voxpery}"
OUT_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

docker compose exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" | gzip -9 > "$OUT_FILE"

echo "Backup created: $OUT_FILE"
