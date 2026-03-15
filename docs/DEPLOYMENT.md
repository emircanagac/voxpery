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
- `ADMIN_PASSWORD`
- `COOKIE_SECURE=1` (when using HTTPS)
- `CORS_ORIGINS` with your production origins only
- `VITE_API_URL` (public backend URL used by frontend build)

## 2) Start Full Stack

```bash
docker compose up -d --build
docker compose ps
```

Default ports:

- Web: `http://localhost:${WEB_PORT:-5173}`
- API: `http://localhost:3001`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- LiveKit: `localhost:7880`

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

## 5) DockerHub (Optional, Recommended for Production)

You can prebuild and push images, then use `image:` in compose.

Example:

```bash
docker build -t <dockerhub-user>/voxpery-server:v0.1.0 ./apps/server
docker build -t <dockerhub-user>/voxpery-web:v0.1.0 ./apps/web
docker push <dockerhub-user>/voxpery-server:v0.1.0
docker push <dockerhub-user>/voxpery-web:v0.1.0
```

Then switch compose services from `build:` to:

```yaml
server:
  image: <dockerhub-user>/voxpery-server:v0.1.0

web:
  image: <dockerhub-user>/voxpery-web:v0.1.0
```

## 6) Backups

```bash
docker compose exec postgres pg_dump -U ${POSTGRES_USER:-voxpery} ${POSTGRES_DB:-voxpery} > backup-$(date +%F).sql
```

## Notes

- LiveKit runs on bridge networking with explicit port mappings for cross-platform compatibility.
- Backend migrations run automatically on startup.
- Frontend is built at image build time, so changing `VITE_API_URL` requires rebuilding the `web` image.
