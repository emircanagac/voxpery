#!/usr/bin/env bash
# Creates .env from .env.example with fresh random secrets. With the three public domains it
# also writes the production values for the bundled HTTPS proxy (docker-compose.proxy.yml).
# An existing .env is never changed.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/../.." && pwd)"

example_file="$root_dir/.env.example"
output_file="$root_dir/.env"
web_domain=""
api_domain=""
livekit_domain=""
node_ip=""
image_tag=""

usage() {
  cat <<'EOF'
Usage: scripts/ops/init_env.sh [options]

Without options: writes .env for a local test on this machine (http://localhost).

For a public server behind the bundled HTTPS proxy, pass all three domains:
  --web-domain chat.example.com       address people open in the browser
  --api-domain api.example.com        API and WebSocket
  --livekit-domain livekit.example.com  voice and screen sharing

Optional:
  --node-ip 203.0.113.10   public IPv4 of this server, for voice behind NAT
  --image-tag v0.5.4       release images to run (default: this checkout's version)
  --output PATH            write somewhere other than .env
  --example PATH           read a template other than .env.example
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --web-domain) web_domain="${2:-}"; shift 2 ;;
    --api-domain) api_domain="${2:-}"; shift 2 ;;
    --livekit-domain) livekit_domain="${2:-}"; shift 2 ;;
    --node-ip) node_ip="${2:-}"; shift 2 ;;
    --image-tag) image_tag="${2:-}"; shift 2 ;;
    --output) output_file="${2:-}"; shift 2 ;;
    --example) example_file="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done

[ -f "$example_file" ] || die "Template not found: $example_file"
[ -n "$output_file" ] || die "--output needs a path"
if [ -e "$output_file" ]; then
  die "$output_file already exists and was left unchanged. Remove it first to start over."
fi

is_domain() {
  [[ "$1" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]
}

domains_given=0
for value in "$web_domain" "$api_domain" "$livekit_domain"; do
  [ -n "$value" ] && domains_given=$((domains_given + 1))
done
if [ "$domains_given" -ne 0 ] && [ "$domains_given" -ne 3 ]; then
  die "Pass --web-domain, --api-domain and --livekit-domain together."
fi
if [ "$domains_given" -eq 3 ]; then
  for value in "$web_domain" "$api_domain" "$livekit_domain"; do
    is_domain "$value" || die "Not a domain name (lower case, no scheme or path): $value"
  done
  if [ "$web_domain" = "$api_domain" ] || [ "$web_domain" = "$livekit_domain" ] \
    || [ "$api_domain" = "$livekit_domain" ]; then
    die "The three domains must be different."
  fi
fi
if [ -n "$node_ip" ] && ! [[ "$node_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  die "--node-ip must be an IPv4 address: $node_ip"
fi
if [ -n "$image_tag" ] && ! [[ "$image_tag" =~ ^[A-Za-z0-9._-]+$ ]]; then
  die "--image-tag may only contain letters, digits, dots, dashes and underscores."
fi

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

umask 077
work_file="$(mktemp "${output_file}.XXXXXX")"
trap 'rm -f "$work_file" "$work_file.next"' EXIT

tr -d '\r' < "$example_file" > "$work_file"

# Replaces the active `KEY=...` line, or appends the key when the template has none.
set_value() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$work_file"; then
    awk -v key="$key" -v value="$value" '
      index($0, key "=") == 1 { print key "=" value; next }
      { print }
    ' "$work_file" > "$work_file.next"
    mv "$work_file.next" "$work_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$work_file"
  fi
}

# Every active placeholder gets its own secret; commented examples stay as they are.
secret_keys="$(grep -E '^[A-Z0-9_]+=.*CHANGE_ME' "$work_file" | cut -d= -f1 || true)"
[ -n "$secret_keys" ] || die "No CHANGE_ME placeholders found in $example_file"
for key in $secret_keys; do
  set_value "$key" "$(random_secret)"
done

if [ "$domains_given" -eq 3 ]; then
  if [ -z "$image_tag" ]; then
    version="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$root_dir/apps/web/package.json" | head -n 1)"
    [ -n "$version" ] || die "Could not read the version from apps/web/package.json; pass --image-tag."
    image_tag="v$version"
  fi

  printf '\n## Written by scripts/ops/init_env.sh for docker-compose.proxy.yml\n' >> "$work_file"
  set_value APP_ENV production
  # The key name is an identifier, not a secret; a public server should not keep `devkey`.
  set_value LIVEKIT_API_KEY "voxpery$(random_secret | cut -c1-12)"
  set_value VITE_API_URL "https://$api_domain"
  set_value PUBLIC_API_URL "https://$api_domain"
  set_value ATTACHMENTS_PUBLIC_BASE_URL "https://$api_domain"
  set_value CORS_ORIGINS "https://$web_domain,tauri://localhost,voxpery://auth"
  set_value COOKIE_SECURE 1
  set_value LIVEKIT_WS_URL "wss://$livekit_domain"
  set_value FRONTEND_URL "https://$web_domain"
  set_value WEB_API_URL "https://$api_domain"
  set_value WEB_LIVEKIT_URL "wss://$livekit_domain"
  set_value PROXY_WEB_DOMAIN "$web_domain"
  set_value PROXY_API_DOMAIN "$api_domain"
  set_value PROXY_LIVEKIT_DOMAIN "$livekit_domain"
  set_value VOXPERY_SERVER_IMAGE "voxpery/voxpery-server:$image_tag"
  set_value VOXPERY_WEB_IMAGE "voxpery/voxpery-web:$image_tag"
  if [ -n "$node_ip" ]; then
    set_value LIVEKIT_NODE_IP "$node_ip"
  fi
fi

mv "$work_file" "$output_file"
trap - EXIT

echo "Wrote $output_file with new secrets."
if [ "$domains_given" -eq 3 ]; then
  cat <<EOF
Next:
  1. Point $web_domain, $api_domain and $livekit_domain at this server.
  2. Open ports 80/tcp, 443/tcp, 443/udp, 7881/tcp, 7882/udp and 50000-50200/udp.
  3. docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --no-build
EOF
  if [ -z "$node_ip" ]; then
    echo "Also set LIVEKIT_NODE_IP=<public IPv4 of this server> in $output_file so voice can connect."
  fi
else
  echo "Next: docker compose up -d --build, then open http://localhost:5173"
fi
