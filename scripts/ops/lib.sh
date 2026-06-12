#!/usr/bin/env bash

ops_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ops_root_dir="$(cd "$ops_script_dir/../.." && pwd)"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

cd_ops_root() {
  cd "$ops_root_dir"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

compose() {
  docker compose "$@"
}

compose_exec() {
  local service="$1"
  shift
  compose exec -T "$service" "$@"
}

service_exists() {
  local service="$1"
  compose config --services 2>/dev/null | grep -qx "$service"
}

resolve_service() {
  local env_name="$1"
  shift
  local configured="${!env_name:-}"

  if [[ -n "$configured" ]]; then
    service_exists "$configured" || die "$env_name is set to '$configured', but that compose service does not exist"
    echo "$configured"
    return
  fi

  local candidate
  for candidate in "$@"; do
    if service_exists "$candidate"; then
      echo "$candidate"
      return
    fi
  done

  die "Could not resolve compose service for $env_name. Tried: $*"
}

require_running_service() {
  local service="$1"
  if ! compose ps --services --filter "status=running" | grep -qx "$service"; then
    die "Service not running: $service"
  fi
}

redact_logs() {
  sed -E \
    -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[redacted-email]/g' \
    -e 's/(password|passwd|pwd|secret|token|jwt|authorization|api[_-]?key)([=: ]+)[^[:space:]"'"'"']+/\1\2[redacted]/Ig' \
    -e 's/(Bearer )[A-Za-z0-9._~+\/=-]+/\1[redacted]/g'
}

require_ops_runtime() {
  require_command docker
  compose version >/dev/null 2>&1 || die "Docker Compose is not available"
}
