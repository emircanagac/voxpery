# Contributing to Voxpery

Thanks for helping improve Voxpery.

## Prerequisites

- Rust (stable)
- Node.js `>=24.0.0`
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

## Your First Contribution

1. **Find a small task.** Issues labelled
   [`good first issue`](https://github.com/emircanagac/voxpery/labels/good%20first%20issue) and
   [`help wanted`](https://github.com/emircanagac/voxpery/labels/help%20wanted) are meant for
   newcomers. If none are open, or you want to fix something else, open an issue first and describe
   what you plan to change, so the work is not done twice.
2. **Read the part you will touch.** [ARCHITECTURE.md](ARCHITECTURE.md) explains how the backend,
   web client, desktop app and LiveKit fit together; [UI_BEHAVIOR.md](UI_BEHAVIOR.md) describes the
   interface rules, [API.md](API.md), [WEBSOCKET_EVENTS.md](WEBSOCKET_EVENTS.md) and
   [DATABASE.md](DATABASE.md) the contracts. [DEVELOPMENT.md](DEVELOPMENT.md) has the full local
   setup, including the test database.
3. **Run the checks for what you changed.** CI runs the whole matrix on your pull request; locally,
   run the fast checks for the area you touched:

   | You changed | Run |
   |---|---|
   | Server (`apps/server`) | `cargo check --locked --tests`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo fmt --check`, and `cargo test --locked <name>` for the tests near your change. Integration tests need PostgreSQL and Redis: `node scripts/dev/local-qa.mjs backend-test -- <name> --test-threads=1` from the repository root. |
   | Web (`apps/web`) | `npx tsc -b`, `npm run lint`, `npx vitest run <files>`, and for a changed screen the Playwright spec that covers it: `npx playwright test <spec> --project=chromium --workers=1`. |
   | Migrations | `node .github/scripts/validate-migration-history.mjs`. Never edit a migration that is already merged; add a new one. |
   | Workflows or scripts | `node --test .github/scripts/*.test.mjs scripts/dev/*.test.mjs scripts/tests/*.test.mjs` |
   | Documentation only | Check that every link you added opens. |

4. **Keep the pull request to one change**, with a short description of what changed, why, and which
   checks you ran.

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
npm run check:initial-bundle
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

- Desktop release hardening and updater readiness
- Media parity work (GIF/sticker/custom emoji, image previews)
- Scaling/self-host operations docs
- Public contributor onboarding and issue quality

## Community Standards

- Code of Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Bug report template: [../.github/ISSUE_TEMPLATE/bug.md](../.github/ISSUE_TEMPLATE/bug.md)
- Feature request template: [../.github/ISSUE_TEMPLATE/feature.md](../.github/ISSUE_TEMPLATE/feature.md)

---

Last verified against code on 2026-11-15.
