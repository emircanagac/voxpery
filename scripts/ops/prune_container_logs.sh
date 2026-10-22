#!/usr/bin/env bash
set -Eeuo pipefail

# Keeps the stack's Docker json-file logs within the 14 days the hosted Privacy Notice states.
# Docker rotates these logs by size only, so run this daily as root, e.g.:
#   30 3 * * * cd /opt/voxpery && ./scripts/ops/prune_container_logs.sh >> /var/log/voxpery-logs.log 2>&1
# Rotated files older than half the limit are removed, and the live file is emptied once its
# first entry is older than half the limit, so no line is kept longer than LOG_RETENTION_DAYS.
# LOG_PRUNE_DRY_RUN=1 only reports what would be removed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
cd_ops_root
require_ops_runtime

LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-14}"
[[ "$LOG_RETENTION_DAYS" =~ ^[0-9]+$ ]] && (( LOG_RETENTION_DAYS >= 2 )) \
  || die "LOG_RETENTION_DAYS must be a whole number of at least 2"
half_minutes=$(( LOG_RETENTION_DAYS * 24 * 60 / 2 ))
dry_run="${LOG_PRUNE_DRY_RUN:-}"
delete_flag=(-delete)
[[ "$dry_run" == "1" ]] && delete_flag=()
cutoff_epoch=$(( $(date -u +%s) - half_minutes * 60 ))

container_ids="$(compose ps -aq)"
[[ -n "$container_ids" ]] || { info "No stack containers found"; exit 0; }

while read -r name log_path; do
  [[ -n "$log_path" && -f "$log_path" ]] || continue
  find "$(dirname "$log_path")" -maxdepth 1 -type f -name "$(basename "$log_path").*" \
    -mmin "+$half_minutes" -print "${delete_flag[@]}" | sed "s|^|$name: rotated log past the limit |"
  first_time="$(head -n 1 "$log_path" | grep -o '"time":"[^"]*"' | cut -d'"' -f4 || true)"
  [[ -n "$first_time" ]] || continue
  first_epoch="$(date -u -d "$first_time" +%s 2>/dev/null || echo 0)"
  if (( first_epoch > 0 && first_epoch < cutoff_epoch )); then
    [[ "$dry_run" == "1" ]] || truncate -s 0 "$log_path"
    info "$name: log started at $first_time, past the limit${dry_run:+ (dry run, kept)}"
  fi
done < <(docker inspect --format '{{.Name}} {{.LogPath}}' $container_ids)
