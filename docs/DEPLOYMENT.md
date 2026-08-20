# Deployment Guide

This repository now supports a **full Docker Compose deployment**:

- `postgres`
- `redis`
- `livekit`
- `server` (Rust backend)
- `web` (React static build served by Nginx)

## Prerequisites

- Docker Engine + Docker Compose v2
- A copied `.env` file from `.env.example`

## 1) Prepare Environment

```bash
git clone https://github.com/emircanagac/voxpery.git
cd voxpery
cp .env.example .env
```

Edit `.env` and set strong production values at minimum:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_NODE_IP` (server public IPv4)
- `ADMIN_PASSWORD`
- `COOKIE_SECURE=1` (when using HTTPS)
- `CORS_ORIGINS` with your production origins only
- Keep every web origin that sends cookie-authenticated writes in `CORS_ORIGINS`; the
  same allowlist is used for server-side CSRF origin verification.
- If a reverse proxy supplies client IP headers, set `TRUSTED_PROXY_CIDRS` to that
  proxy's exact IP or dedicated network CIDR. Leave it empty for direct deployments.
- `VITE_API_URL` (public backend URL used by frontend build)
- `VITE_GIPHY_API_KEY` (optional public client key for GIPHY search/trending; configure the same repository variable for web and desktop release builds)
- `FRONTEND_URL` (public web app URL used in password reset and email verification links)
- `ATTACHMENTS_PUBLIC_BASE_URL` (for uploaded file URLs; usually your API domain)

Reverse proxy note:

- Configure the proxy to replace `X-Real-IP` and append its observed client address
  to `X-Forwarded-For`. Never pass client-provided forwarding headers through unchanged.
- Strip `CF-Connecting-IP` unless the request came through a verified Cloudflare path;
  otherwise overwrite it with the value supplied by that trusted edge.
- For a host proxy connecting through Docker's bridge, inspect the gateway with
  `docker network inspect voxpery_default` and prefer its exact `/32` or `/128`
  address over trusting the entire bridge network.

LiveKit note:

- Compose uses `use_external_ip: false` (deterministic mode).
- Set `LIVEKIT_NODE_IP` in production to avoid external IP discovery failures in containerized deployments.

Attachments note:

- Uploads are local-only and served via signed URLs under `/api/attachments/content/*`.
- Configure with:
  - `ATTACHMENTS_LOCAL_DIR`
  - `ATTACHMENTS_KEY_PREFIX`
  - `ATTACHMENTS_PUBLIC_BASE_URL`
  - `ATTACHMENTS_URL_TTL_SECS`

Optional integrations note:

- Google OAuth is disabled unless `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set.
- Privacy-safe operational observability is disabled by default. Set `OBSERVABILITY_ENABLED=true`
  only when the deployment needs aggregate reliability counters; see
  [OBSERVABILITY.md](OBSERVABILITY.md) for the fixed event schema and retention policy.
- `OBSERVABILITY_RATE_LIMIT_MAX` and `OBSERVABILITY_RATE_LIMIT_WINDOW_SECS` control the
  unauthenticated event endpoint's per-network-fingerprint limit. Defaults are `120` and `60`.
- Email delivery is disabled unless `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` are all set.
- SMTP delivery uses STARTTLS on submission port 587 and forces an IPv4 outbound connection, matching hosts that do not provide Docker IPv6 routing.
- Password reset and email verification depend on email delivery.
- Set `FRONTEND_URL` to the public web origin, for example `https://voxpery.com`, so email links do not depend on `CORS_ORIGINS` ordering.
- The official server image prefers IPv4 for outbound SMTP resolution. This avoids IPv6-only DNS answers causing `Network is unreachable` on hosts or Docker networks without IPv6 routing.
- The backend publishes integration availability at `/api/system/features`; web and desktop clients hide unavailable flows.
- Direct calls to disabled integration endpoints return `FEATURE_DISABLED`.
- `EMAIL_VERIFICATION_REQUIRED=true` requires SMTP email delivery and fails startup if email delivery is not configured.
- Keep disabled optional integrations commented out in `.env`; do not set optional variables to empty values.

## 2) Self-Host Smoke Test

Before production changes, validate the default self-host flow from a clean environment file:

```bash
cp .env.example .env
# Edit `.env` and replace every CHANGE_ME value.
docker compose config >/dev/null
docker compose up -d --build
docker compose ps
```

Basic service checks:

```bash
curl -f http://localhost:3001/health
curl -I http://localhost:${WEB_PORT:-5173}
curl -f http://localhost:${WEB_PORT:-5173}/healthz
curl -s http://localhost:3001/api/system/features
```

Expected default integration state:

- `google_oauth_enabled` is `false`.
- `email_delivery_enabled` is `false`.
- `email_verification_enabled` is `false`.
- `password_reset_enabled` is `false`.
- The web and desktop UI should hide Google sign-in, password reset, and email verification prompts until those integrations are configured.

Manual product checks:

- Register/login works with the seeded admin account or a new local account.
- Server, channel, and category navigation work.
- Voice join reaches LiveKit.
- Attachment upload and signed attachment viewing work.

## 3) Start Full Stack

```bash
docker compose up -d --build
docker compose ps
```

ClamAV is disabled by default in compose.
To use malware scanning in production:

```bash
ATTACHMENTS_CLAMAV_ENABLED=1 docker compose --profile security up -d
```

Or set `ATTACHMENTS_CLAMAV_ENABLED=1` in `.env` and always deploy with `--profile security`.

The bundled GitHub Actions production deploy workflow expects your production `.env` to already contain the correct attachment scanning settings and deploys with `docker compose --profile security ...`.

Default ports:

- Web: `http://localhost:${WEB_PORT:-5173}`
- API: `http://localhost:3001`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- LiveKit: `localhost:7880`

Security defaults in compose:

- `web`, `server`, `postgres`, `redis`, `livekit:7880` bind to `127.0.0.1` only
- Local compose passes `APP_ENV=development` and builds the web image with `apps/web/nginx.development.conf` so localhost API and LiveKit smoke tests work. Public production images pass `APP_ENV=production` in CI and use `apps/web/nginx.production.conf`, which omits browser loopback `connect-src` allowances.
- The web image uses unprivileged nginx and listens on container port `8080`; Compose maps it to `127.0.0.1:${WEB_PORT:-5173}`.
- Production web responses include HSTS, CSP, frame denial, MIME sniffing protection, a no-referrer policy, and media-aware Permissions Policy. API responses apply the corresponding API-safe policy in Axum, including error and CORS preflight responses.
- Do not override or remove these headers at the public reverse proxy. The release smoke workflow validates the deployed API `/health` and web `/healthz` responses and fails on policy drift.
- Public media ports stay open for LiveKit:
  - `7881/tcp` (fallback)
  - `7882/udp`
  - `50000-50200/udp`
- Container logs use rotation (`max-size=10m`, `max-file=5`) to avoid disk growth

Important:

- The default `docker-compose.yml` applies conservative LiveKit limits even if you do not customize `.env`.
- The bundled LiveKit config sends signed participant lifecycle webhooks to the internal server service. It reuses `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`; no extra public webhook URL or secret is required for Compose deployments.
- Default values are:
  - `LIVEKIT_CPUS_LIMIT=2.0`
  - `LIVEKIT_MEM_LIMIT=1500m`
  - `LIVEKIT_PIDS_LIMIT=512`
- You can override these values from `.env` on smaller or larger hosts.
- These limits reduce single-host blast radius (LiveKit cannot consume all CPU/RAM/PIDs).
- They do **not** protect against upstream bandwidth saturation from large volumetric UDP floods.

## 4) Horizontal Scaling Notes

The backend is ready for multiple instances for REST traffic and cross-instance WebSocket event delivery when all instances share the same Postgres, Redis, `JWT_SECRET`, and public configuration.

- Redis is required for JWT blacklist checks, distributed rate limits, and the WebSocket event bus.
- WebSocket broadcast events are bridged through Redis Pub/Sub so clients connected to different backend instances receive message, server, channel, member, profile, presence, friend, and DM notifications.
- Active WebSocket socket handles remain process-local. This is expected; each instance only writes to the sockets it owns.
- REST responses that derive online/offline from active socket maps are still instance-local. Use sticky routing or keep a single backend instance if exact presence in list responses is required before Redis-backed presence is added.
- Voice session/control state currently remains process-local for `JoinVoice`, `LeaveVoice`, moderation controls, and legacy `Signal` forwarding. If you run more than one backend instance before this state is externalized, configure sticky routing for `/ws`.
- Local attachment storage is per-instance. For multiple backend instances, mount the same persistent shared volume for `ATTACHMENTS_LOCAL_DIR` or move attachments to a shared object storage backend before scaling writes.
- Prefer one LiveKit deployment endpoint shared by all backend instances.

## 5) Validation Checklist

```bash
curl -f http://localhost:3001/health
curl -f http://localhost:${WEB_PORT:-5173}/healthz
curl -I http://localhost:${WEB_PORT:-5173}
```

The public API health response intentionally stays minimal and should only report `status=ok`. Use `scripts/ops/stack_healthcheck.sh` for server-side dependency checks.

Manual checks:

- Register/login works
- Server/channel/category permissions work
- Voice join works
- Moderation actions (kick/ban) work

## 6) Updating

```bash
git pull
docker compose up -d --build
```

## 7) Prebuilt Images (Optional, Recommended for Production)

You can prebuild and push images, then let Compose pull them during deploy instead of rebuilding on the server.

Recommended tagging strategy:

- `vX.Y.Z` for release tag builds
- `sha-<commit>` for manually deployed main-candidate builds

Do not use `latest` for production deploys. Production should deploy an exact
image tag so the running image can be tied back to a commit or release tag and
rolled back safely.

Example:

```bash
docker build -t <dockerhub-user>/voxpery-server:<tag> ./apps/server
docker build --build-arg VITE_APP_VERSION=<tag> -t <dockerhub-user>/voxpery-web:<tag> ./apps/web
docker push <dockerhub-user>/voxpery-server:<tag>
docker push <dockerhub-user>/voxpery-web:<tag>
```

Then set these optional variables in `.env` (or directly on the server):

```bash
VOXPERY_SERVER_IMAGE=<dockerhub-user>/voxpery-server:<tag>
VOXPERY_WEB_IMAGE=<dockerhub-user>/voxpery-web:<tag>
```

Production deploys should pull the exact image tag selected for the release:

```bash
export VOXPERY_SERVER_IMAGE=voxpery/voxpery-server:<tag>
export VOXPERY_WEB_IMAGE=voxpery/voxpery-web:<tag>
docker compose pull server web
docker compose up -d --no-build --remove-orphans
```

The bundled production deploy workflow supports automatic stable-release deploys
and manual deploy channels. Publishing a non-prerelease GitHub Release with a
`vX.Y.Z` tag starts CI validation and publishes both immutable Docker images.
After both image jobs succeed, CI verifies that the tag belongs to the published
Release and calls the production deploy workflow. The deploy verifies that both
the backend and frontend image tags exist before changing the server, then runs
health, deployed-version, and cache-policy smoke checks.

Docker Hub can briefly report a newly pushed tag as unavailable after the build
job succeeds. The deploy gate retries both backend and frontend immutable image
lookups before touching production and fails closed if either tag never becomes
visible. Manual and automatic deploys use this same registry guard.

The deploy host runs `scripts/ops/stack_healthcheck.sh` until the stack passes
three consecutive rounds. This verifies that every required Compose service is
running, the API reports `status=ok`, PostgreSQL and Redis are ready, attachment
storage is writable, and the web health endpoint responds. A transient
`docker ps` running state is not accepted because a restart-looping backend can
briefly appear healthy between crashes.
The runner then checks out the current `main` deployment tooling before it
validates the public web health endpoint, security headers, `/version.json`
release metadata, and stable entry-point cache policy. This keeps smoke
guardrail fixes effective when an older immutable release tag is deployed.
Public API edge and security-header checks
remain part of the independent manual release smoke because Cloudflare may
intentionally reject requests from both GitHub-hosted runner networks and the
production host's datacenter address.

The public cache check verifies that the app shell, service worker, and
`/version.json` revalidate so normal reloads can pick up deployment changes.
Fingerprint asset caching remains an origin/CDN configuration concern rather
than a production availability gate.

Manual runs remain available for redeploys, release recovery, candidates, and
explicit rollback operations:

- `latest-release` (default): finds the newest `v*` tag, checks out that tag,
  and deploys the matching `vX.Y.Z` image tag.
- `main-candidate`: resolves `main` (or the optional `git_ref`) to an exact
  commit, builds and pushes the matching `sha-<commit>` server and web images,
  then deploys that same immutable image tag for pre-release verification.
- `custom`: requires both `git_ref` and `image_tag` for explicit rollback or
  advanced operations.

All channels refuse the Docker `latest` tag. The default `latest-release`
channel keeps manual redeploys close to one-click while still pinning production
to a concrete release version. Automatic and manual deploys share one production
concurrency lock, so they cannot modify production at the same time. Re-running
the same release deploy is safe and remains pinned to the same immutable images.

Docker images are published automatically only for `v*` tag pushes. Main-branch
pushes run validation but do not push Docker images, keeping Docker Hub focused
on stable releases. A tag push that is not backed by a published, non-prerelease
GitHub Release is refused by the automatic production deploy gate. When you need
a pre-release `main-candidate` deploy, run the
manual deploy workflow with the `main-candidate` channel; it publishes the
matching `sha-<commit>` server and web images before deploying them.

Set the optional repository variables `PRODUCTION_API_URL` and
`PRODUCTION_WEB_URL` when deploying a fork to different public endpoints. They
default to `https://api.voxpery.com` and `https://voxpery.com` for the hosted
service and are used by the post-deploy smoke check.

CI-built web images embed the resolved deploy tag as `VITE_APP_VERSION` and show
it beside the `Beta` badge in the top bar. This should match the selected server
and web image tag (`vX.Y.Z` for stable releases or `sha-<commit>` for manually
deployed main candidates). For manual image builds, pass
`--build-arg VITE_APP_VERSION=<tag>` to keep the visible badge aligned with the
image tag.

The web container requires release entry points (`/`, `/index.html`, `/sw.js`,
and `/version.json`) and the stable RNNoise worklet URL to be revalidated on
every normal reload. Fingerprinted `/assets/` files are cached for one year
because a new
build produces new URLs. Do not override the entry-point headers with a CDN
browser-cache rule: the release smoke workflow verifies that the app shell,
service worker, and release metadata return a revalidation policy, preventing
stale releases from requiring `Ctrl+F5`.

For Cloudflare, set Browser Cache TTL to `Respect existing headers` and do not
apply an Edge Cache TTL override to `/`, `/index.html`, `/sw.js`,
`/version.json`, or `/assets/rnnoise-worklet.js`. A broad four-hour Browser
Cache TTL rule, for
example, replaces the origin's revalidation header with `max-age=14400` and
causes the post-deploy cache smoke to fail. Fingerprinted `/assets/*` files may
keep a long-lived edge/browser cache rule, except for the stable RNNoise worklet
path above.

## 8) Backups

```bash
./scripts/ops/db_backup.sh
```

Dry-run backup preflight:

```bash
BACKUP_DRY_RUN=1 ./scripts/ops/db_backup.sh
```

Restore (explicit confirmation required):

```bash
RESTORE_CONFIRM=YES ./scripts/ops/db_restore.sh backups/postgres/<backup-file>.sql.gz
```

Dry-run restore validation:

```bash
RESTORE_DRY_RUN=1 ./scripts/ops/db_restore.sh backups/postgres/<backup-file>.sql.gz
```

Healthcheck:

```bash
./scripts/ops/stack_healthcheck.sh
./scripts/ops/critical_log_scan.sh
```

For production operations, alerting and restore drill checklist, see:

- `docs/OPERATIONS_RUNBOOK.md`

## Notes

- LiveKit runs on bridge networking with explicit port mappings for cross-platform compatibility.
- Backend migrations run automatically on startup.
- Frontend is built at image build time, so changing `VITE_API_URL` or `VITE_GIPHY_API_KEY` requires rebuilding the `web` image.
