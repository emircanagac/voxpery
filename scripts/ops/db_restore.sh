#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup.sql|backup.sql.gz>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
cd_ops_root
require_ops_runtime

INPUT_FILE="$1"
if [[ ! -f "$INPUT_FILE" ]]; then
  die "Backup file not found: $INPUT_FILE"
fi

DB_NAME="${POSTGRES_DB:-voxpery}"
DB_USER="${POSTGRES_USER:-voxpery}"
POSTGRES_SERVICE="$(resolve_service POSTGRES_SERVICE postgres db)"

require_running_service "$POSTGRES_SERVICE"
compose_exec "$POSTGRES_SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

if [[ "$INPUT_FILE" == *.gz ]]; then
  gzip -t "$INPUT_FILE"
fi

if [[ "${RESTORE_DRY_RUN:-}" == "1" ]]; then
  info "Dry run passed. Restore source is readable and database is reachable: $INPUT_FILE -> $DB_NAME"
  exit 0
fi

if [[ "${RESTORE_CONFIRM:-}" != "YES" ]]; then
  echo "Refusing restore without explicit confirmation."
  echo "Run with: RESTORE_CONFIRM=YES $0 $INPUT_FILE"
  echo "Optional validation only: RESTORE_DRY_RUN=1 $0 $INPUT_FILE"
  exit 1
fi

if [[ "${RESTORE_SKIP_PRE_BACKUP:-}" != "YES" ]]; then
  info "Creating a pre-restore backup. Set RESTORE_SKIP_PRE_BACKUP=YES only if an external backup already exists."
  BACKUP_LABEL="pre_restore" "$SCRIPT_DIR/db_backup.sh"
fi

if [[ "$INPUT_FILE" == *.gz ]]; then
  gzip -dc "$INPUT_FILE" | compose_exec "$POSTGRES_SERVICE" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME"
else
  compose_exec "$POSTGRES_SERVICE" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" < "$INPUT_FILE"
fi

echo "Restore completed: $INPUT_FILE -> $DB_NAME"
