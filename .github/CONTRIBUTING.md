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
docker compose up -d
```

Run backend:

```bash
cd apps/server
cargo run
```

Run frontend in a new terminal:

```bash
cd apps/web
npm ci
npm run dev
```

## Before Opening a PR

Run:

```bash
cd apps/server
cargo check
cargo test

cd ../web
npm run lint
npm run build
```

## Documentation Sync

If your PR changes auth, permissions, channels, database behavior, WebSocket
events, or deployment assumptions, update the matching docs in the same PR.

Key docs:

- [docs/API.md](../docs/API.md)
- [docs/DATABASE.md](../docs/DATABASE.md)
- [docs/WEBSOCKET_EVENTS.md](../docs/WEBSOCKET_EVENTS.md)
- [docs/SECURITY.md](../docs/SECURITY.md)
- [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)

## Git Workflow

1. Create a branch
2. Commit with conventional commits such as `feat:`, `fix:`, `docs:`, `chore:`
3. Open a pull request
4. Ensure CI passes before merge

## Current Priority Areas

- Voice and WebRTC automated coverage expansion
- Desktop release hardening
- Scaling and self-host operations docs
- Mobile and responsive UX polish

## Community Standards

- Code of Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Bug report template: [bug.md](./ISSUE_TEMPLATE/bug.md)
- Feature request template: [feature.md](./ISSUE_TEMPLATE/feature.md)

For the docs version, see [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md).
