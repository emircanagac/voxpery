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
- `VITE_API_URL` (public backend URL used by frontend build)
- `ATTACHMENTS_PUBLIC_BASE_URL` (for uploaded file URLs; usually your API domain)

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

## 2) Start Full Stack

```bash
docker compose up -d --build
docker compose ps
```

ClamAV now starts by default in compose.
To use malware scanning, keep `ATTACHMENTS_CLAMAV_ENABLED=1` in `.env`.

Default ports:

- Web: `http://localhost:${WEB_PORT:-5173}`
- API: `http://localhost:3001`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- LiveKit: `localhost:7880`

Security defaults in compose:

- `web`, `server`, `postgres`, `redis`, `livekit:7880` bind to `127.0.0.1` only
- Public media ports stay open for LiveKit:
  - `7881/tcp` (fallback)
  - `7882/udp`
  - `50000-50200/udp`
- Container logs use rotation (`max-size=10m`, `max-file=5`) to avoid disk growth

Important:

- LiveKit limits are optional in `docker-compose.yml`.
- If `LIVEKIT_CPUS_LIMIT`, `LIVEKIT_MEM_LIMIT`, `LIVEKIT_PIDS_LIMIT` are unset in `.env`, no cgroup limits are applied.
- These limits reduce single-host blast radius (LiveKit cannot consume all CPU/RAM/PIDs).
- They do **not** protect against upstream bandwidth saturation from large volumetric UDP floods.
- To activate limits in production, set these keys in `.env`:
  - `LIVEKIT_CPUS_LIMIT`
  - `LIVEKIT_MEM_LIMIT`
  - `LIVEKIT_PIDS_LIMIT`

Recommended starting values:

- `LIVEKIT_CPUS_LIMIT=4.0`
- `LIVEKIT_MEM_LIMIT=3g`
- `LIVEKIT_PIDS_LIMIT=1024`

## 3) Validation Checklist

```bash
curl -f http://localhost:3001/health
curl -I http://localhost:${WEB_PORT:-5173}
```

Manual checks:

- Register/login works
- Server/channel/category permissions work
- Voice join works
- Moderation actions (kick/ban) work

## 4) Updating

```bash
git pull
docker compose up -d --build
```

## 5) Prebuilt Images (Optional, Recommended for Production)

You can prebuild and push images, then let Compose pull them during deploy instead of rebuilding on the server.

Recommended tagging strategy:

- `latest` for rolling production deploys
- `sha-<commit>` when you want to pin an exact build

Example:

```bash
docker build -t <dockerhub-user>/voxpery-server:<tag> ./apps/server
docker build -t <dockerhub-user>/voxpery-web:<tag> ./apps/web
docker push <dockerhub-user>/voxpery-server:<tag>
docker push <dockerhub-user>/voxpery-web:<tag>
```

Then set these optional variables in `.env` (or directly on the server):

```bash
VOXPERY_SERVER_IMAGE=<dockerhub-user>/voxpery-server:<tag>
VOXPERY_WEB_IMAGE=<dockerhub-user>/voxpery-web:<tag>
```

Current production deploy workflow can then use:

```bash
docker compose pull server web
docker compose up -d --no-build --remove-orphans
```

## 6) Backups

```bash
./scripts/ops/db_backup.sh
```

Restore (explicit confirmation required):

```bash
RESTORE_CONFIRM=YES ./scripts/ops/db_restore.sh backups/postgres/<backup-file>.sql.gz
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
- Frontend is built at image build time, so changing `VITE_API_URL` requires rebuilding the `web` image.
