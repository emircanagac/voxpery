# Development

Local setup, scripts, and CI behavior for current codebase.

## Prerequisites

- Rust (stable)
- Node.js `>=20.19.0`
- Docker (Postgres, Redis, LiveKit)

## Quick Start

```bash
git clone https://github.com/emircanagac/voxpery.git
cd voxpery
cp .env.example .env
docker compose up -d
```

Backend:

```bash
cd apps/server
cargo run
```

Frontend:

```bash
cd apps/web
npm ci
npm run dev
```

## Environment

Use root `.env` as single source of truth.

Important keys:

- `DATABASE_URL`, `REDIS_URL`
- `JWT_SECRET`, `JWT_EXPIRATION`
- `CORS_ORIGINS`
- `COOKIE_SECURE`, `AUTH_COOKIE_NAME`
- `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `LIVEKIT_RTC_USE_EXTERNAL_IP` (`false` in local dev, `true` for internet-exposed prod)
- `VITE_API_URL`

## Common Commands

### Backend (`apps/server`)

```bash
cargo check
cargo test
cargo run
```

### Frontend (`apps/web`)

```bash
npm ci
npm run lint
npm run build
npm run dev
```

### E2E / custom scripts (`apps/web`)

```bash
npm run test:e2e
npm run smoke:e2e
npm run chaos:reconnect
npm run regression:multi-user
npm run rate-limit:check
```

## CI Workflows

### `.github/workflows/ci.yml`

Runs on `push` and `pull_request`:

- `Secret Scan (gitleaks)` (containerized CLI)
- `Backend` (`cargo check`, `cargo test`)
- `Frontend` (`npm ci`, `npm run lint`, `npm run build`)

### `.github/workflows/dependency-security.yml`

Runs on schedule, manual dispatch, and PR:

- Rust dependency audit (`cargo audit`)
- Web production dependency audit (`npm audit --omit=dev --audit-level=high`)

## Notes

- Permission changes should update: `docs/API.md`, `docs/DATABASE.md`, `docs/WEBSOCKET_EVENTS.md`, and `docs/SECURITY.md`.
- If behavior changes and docs are not updated in same PR, treat it as drift.

---

Last verified against code on 2026-03-14.
