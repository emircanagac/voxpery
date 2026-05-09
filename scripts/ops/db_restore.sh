#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup.sql|backup.sql.gz>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

INPUT_FILE="$1"
if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Backup file not found: $INPUT_FILE"
  exit 1
fi

DB_NAME="${POSTGRES_DB:-voxpery}"
DB_USER="${POSTGRES_USER:-voxpery}"

if [[ "${RESTORE_CONFIRM:-}" != "YES" ]]; then
  echo "Refusing restore without explicit confirmation."
  echo "Run with: RESTORE_CONFIRM=YES $0 $INPUT_FILE"
  exit 1
fi

if [[ "$INPUT_FILE" == *.gz ]]; then
  gzip -dc "$INPUT_FILE" | docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME"
else
  cat "$INPUT_FILE" | docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME"
fi

echo "Restore completed: $INPUT_FILE -> $DB_NAME"
