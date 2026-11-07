#!/bin/sh
# Points the built site at this deployment's public addresses, so one image serves any domain.
# Without WEB_API_URL the addresses chosen at build time stay in place.
set -eu

[ -n "${WEB_API_URL:-}" ] || exit 0

html=/usr/share/nginx/html
conf=/etc/nginx/conf.d/default.conf
hosted_sources='https://api.voxpery.com wss://api.voxpery.com https://livekit.voxpery.com wss://livekit.voxpery.com'

fail() {
  echo "voxpery runtime config: $1" >&2
  exit 1
}

origin_pattern='^(https?|wss?)://[A-Za-z0-9.-]+(:[0-9]+)?$'
key_pattern='^[A-Za-z0-9._-]*$'

api=${WEB_API_URL%/}
livekit=${WEB_LIVEKIT_URL:-}
livekit=${livekit%/}
turnstile=${WEB_TURNSTILE_SITE_KEY:-}
giphy=${WEB_GIPHY_API_KEY:-}

printf '%s' "$api" | grep -Eq "$origin_pattern" || fail 'WEB_API_URL must be an http(s) origin'
if [ -n "$livekit" ]; then
  printf '%s' "$livekit" | grep -Eq "$origin_pattern" || fail 'WEB_LIVEKIT_URL must be a ws(s) or http(s) origin'
fi
# Both keys are optional; grep finds no line in empty input, so check only values that are set.
[ -z "$turnstile" ] || printf '%s' "$turnstile" | grep -Eq "$key_pattern" || fail 'WEB_TURNSTILE_SITE_KEY has invalid characters'
[ -z "$giphy" ] || printf '%s' "$giphy" | grep -Eq "$key_pattern" || fail 'WEB_GIPHY_API_KEY has invalid characters'

to_http() { printf '%s' "$1" | sed -e 's#^wss://#https://#' -e 's#^ws://#http://#'; }
to_ws() { printf '%s' "$1" | sed -e 's#^https://#wss://#' -e 's#^http://#ws://#'; }

sources="$(to_http "$api") $(to_ws "$api")"
if [ -n "$livekit" ]; then
  sources="$sources $(to_http "$livekit") $(to_ws "$livekit")"
fi

cat > "$html/runtime-config.js" <<EOF
window.__VOXPERY_RUNTIME_CONFIG__ = { apiUrl: '$(to_http "$api")', turnstileSiteKey: '$turnstile', giphyApiKey: '$giphy' }
EOF

printf '{"api_base_url":"%s"}\n' "$(to_http "$api")" > "$html/.well-known/voxpery/client"

if grep -Fq "$hosted_sources" "$conf"; then
  tmp=$(mktemp)
  sed "s#$hosted_sources#$sources#" "$conf" > "$tmp"
  cat "$tmp" > "$conf"
  rm -f "$tmp"
fi

# img-src allows any https: origin; a plain-HTTP API (LAN or local setups) also serves avatars and
# images, so allow that one origin too. HTTPS deployments keep the policy unchanged.
api_http=$(to_http "$api")
case "$api_http" in
  http://*)
    if ! grep -Fq "img-src 'self' data: blob: https: $api_http;" "$conf"; then
      tmp=$(mktemp)
      sed "s#img-src 'self' data: blob: https:;#img-src 'self' data: blob: https: $api_http;#" "$conf" > "$tmp"
      cat "$tmp" > "$conf"
      rm -f "$tmp"
    fi
    ;;
esac

echo "voxpery runtime config: API $(to_http "$api")"
