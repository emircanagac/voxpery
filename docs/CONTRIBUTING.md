# Contributing to Voxpery

Thanks for helping improve Voxpery.

## Prerequisites

- Rust (stable)
- Node.js `>=20.19.0`
- Docker

## Local Setup

```bash
git clone https://github.com/emircanagac/voxpery.git
cd voxpery
cp .env.example .env
docker compose up -d postgres redis livekit
```

This starts only the local dependencies used during development. Do not run the full stack compose target if you also plan to start `cargo run` and `npm run dev`, because the containerized `server` and `web` services bind the same localhost ports.

If you want ClamAV during development, start it explicitly:

```bash
docker compose --profile security up -d clamav
```

Run backend:

```bash
cd apps/server
cargo run
```

Run frontend (new terminal):

```bash
cd apps/web
npm ci
npm run dev
```

## Before Opening PR

Run:

```bash
# backend
cd apps/server
cargo check
cargo test

# frontend
cd ../web
npm run lint
npm run build
```

## Documentation Sync (Required)

If your PR changes auth/permissions/channels/database/ws behavior, update docs in the same PR:

- `docs/API.md`
- `docs/DATABASE.md`
- `docs/WEBSOCKET_EVENTS.md`
- `docs/SECURITY.md`

## Git Workflow

1. Create a branch
2. Commit with conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)
3. Open PR
4. Ensure CI passes

## Current Priority Areas

- Voice/WebRTC automated coverage expansion
- Desktop release hardening
- Scaling/self-host operations docs
- Mobile/responsive UX polish

## Community Standards

- Code of Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Bug report template: [../.github/ISSUE_TEMPLATE/bug.md](../.github/ISSUE_TEMPLATE/bug.md)
- Feature request template: [../.github/ISSUE_TEMPLATE/feature.md](../.github/ISSUE_TEMPLATE/feature.md)

---

Last verified against code on 2026-04-04.
