# Development

Local setup, scripts, and CI behavior for current codebase.

## Repository Layout

| Directory | Responsibility |
| --- | --- |
| `apps/web`, `apps/server`, `apps/desktop` | Application sources and their tests. |
| `scripts/dev` | Shared local development launchers and optional build experiments. |
| `scripts/tests` | Standalone regression scripts that exercise application behavior. |
| `scripts/ops` | Deployment, backup and operational commands. |
| `.github/scripts` | CI and release validation helpers. |
| `docs` | Contributor, architecture and operational documentation. |

Keep platform-specific packaging with its owning component. Commit reusable
source, tests, manifests and lockfiles; keep local environments, machine-specific
workarounds, investigation notes and generated artifacts outside tracked files.

## Interaction Regression Coverage

- Message editing uses a multiline field. Enter saves, Shift+Enter inserts a line break, Escape cancels, and IME composition does not submit. Save and Cancel remain available as explicit actions.
- Member rows and message authors open profiles on normal activation. Friends avatars open profiles while the adjacent name/row action still opens a DM. Context menus remain available through right click and the context-menu key.
- The bottom-left avatar/name opens the current profile. Status has a separate control; Edit profile opens settings, including on mobile.
- At 1024px and above, sidebars retain their default 240px widths without resizing. Below 1024px, narrow desktop windows use the same drawers, member sheet, and chat-focused layout as mobile. Old saved panel widths are ignored. Keep the CSS boundary and `src/layout.ts` aligned.
- Custom themes preserve their Light/Dark mode. Custom Light tints the main surfaces instead of nearly white backgrounds; normal Light remains neutral. Text and automatic accents are contrast-adjusted across the generated palette. Independent accent overrides do not recolor surfaces.
- Run unit tests and both desktop/mobile Playwright smoke scripts after changing these shared surfaces. Coverage includes breakpoint transitions, inline photo frames, the shared expression picker, latest-message viewport stability, Settings focus/account dialogs, auth labels, and custom Light persistence.

## Prerequisites

- Rust (stable)
- Node.js `>=24.0.0`
- Docker (Postgres, Redis, LiveKit)

## Quick Start

```bash
git clone https://github.com/emircanagac/voxpery.git
cd voxpery
cp .env.example .env
docker compose --env-file .env up -d --build
```

Configure the root `.env` for local development before starting Compose. This
command builds and runs PostgreSQL, Redis, LiveKit, the Rust API, and the web app
from the same checkout. Open `http://localhost:5173` and check the API at
`http://localhost:3001/health` (unless `.env` sets another `WEB_PORT`). Rebuild
after source changes; do not run separate API/Vite processes on these ports.

ClamAV is optional in development. To run it locally, start it explicitly:

```bash
docker compose --profile security up -d clamav
```

For faster native development, start only the supporting containers instead:

```bash
docker compose --env-file .env up -d postgres redis livekit
```

Then start the backend and frontend from this checkout in separate terminals.
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

### Optional Split Mode (Windows + WSL)

Use the ignored root `.env` as the single configuration source. `node scripts/dev/local-qa.mjs init` checks it without printing credentials or creating another environment file. Use development credentials and, for automated CAPTCHA tests, official Turnstile test keys; never use test keys in production. The launcher rejects production mode.

When desktop registration uses the browser handoff, the server renders Turnstile with `TURNSTILE_SITE_KEY`; it falls back to `VITE_TURNSTILE_SITE_KEY` for the shared local `.env`. Keep `TURNSTILE_SECRET_KEY` server-only.

In a running WSL distribution with Docker Engine/Compose installed, start only
supporting services for the split mode:

```bash
cd /path/to/voxpery
docker compose --env-file .env -p voxpery-qa up -d postgres redis livekit
```

The fixed container names/ports in Compose must be free. PostgreSQL and Redis bind to loopback; LiveKit also exposes media ports. Keep WSL running while testing native Windows clients so localhost forwarding remains available. The Compose project isolates volumes from other project names.

In separate Windows terminals at the repository root:

```powershell
node scripts/dev/local-qa.mjs backend
node scripts/dev/local-qa.mjs frontend
```

Open `http://localhost:5173/register`. Backend health is `http://localhost:3001/health`. This is Docker infrastructure plus native development servers, not production containers. The launcher maps Compose database/Redis hostnames and `localhost` to `127.0.0.1` and derives a native database URL from `POSTGRES_USER/PASSWORD/DB` when `DATABASE_URL` is absent. This avoids Windows IPv6 fallback delays before WSL IPv4 forwarding, which can consume short WebSocket integration deadlines. An explicit `::1` remains explicit; frontend/cookie origins are unchanged. Existing PostgreSQL volumes retain their initialized password; changing `.env` alone does not change the database role. Register disposable local accounts. Email delivery follows the root SMTP configuration.

Backend tests default to a separate database named `<POSTGRES_DB>_tests` (create it before `node scripts/dev/local-qa.mjs backend-test -- --test-threads=1`) and Redis database 1; explicit `TEST_DATABASE_URL/TEST_REDIS_URL` override these defaults. Never point tests at the application or production database. The Compose PostgreSQL bootstrap role is development-only; use separately provisioned, least-privilege database roles for deployment.

The voice moderation/move fixtures retain their two-second WebSocket deadlines. Loopback IPv4 forwarding avoids Windows + WSL IPv6 fallback delays without increasing those deadlines. Fake release-metadata HTTP clients bypass environment proxies, and a timeout reports only expected/observed event types, not event bodies or credentials. Run `node --test scripts/dev/local-qa-config.test.mjs` to validate the loopback-only mapping contract.

For real Google testing, configure development `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in root `.env`, authorize `http://localhost:3001/api/auth/google/callback` in Google Console, and restart the backend. Google remains disabled without credentials. Integration fixtures validate the pending-registration transaction and PKCE exchange without pretending to validate Google's upstream flow.

For desktop QA, keep the frontend running and use `node scripts/dev/local-qa.mjs desktop` from the repository root with the Tauri CLI installed. This loads root `.env` and runs `cargo tauri dev --config tauri.dev.conf.json` in `apps/desktop/src-tauri`. Use only the development config; never broaden release CSP/capabilities for local testing. A packaged production desktop app does not automatically connect to this local backend.

After auth/media changes, run the normal lint/unit/build checks, the CI core and mobile smoke scripts with `--workers=1`, and:

```bash
npx playwright test e2e/auth-core-regressions.spec.ts e2e/voice-media-regressions.spec.ts e2e/floating-stream-regressions.spec.ts --project=chromium --workers=1
```

Keep root `.env` local and untracked.

Test browser and installed Linux clients against the same backend revision;
follow the release checklist for each client pair. `LIVEKIT_WEBHOOK_URL` optionally
changes the Compose webhook destination; its default remains the `server` service.
For a backend running outside Compose, use an address reachable from the LiveKit
container and verify signed webhook delivery. VM forwarding and host addresses
depend on the development environment; retain loopback-only guest listeners.
TCP loopback testing does not validate release UDP/TURN connectivity.

CAPTCHA script failure/timeout is visible and retryable on both registration
surfaces. The retry path never supplies a token or skips server Siteverify.
Run `node --test scripts/tests/desktop-registration-captcha.test.mjs` after web `npm ci`
for the actual server-hosted script's timeout and stale-callback regressions.

Important keys:

- `DATABASE_URL`, `REDIS_URL`
- `JWT_SECRET`, `JWT_EXPIRATION`
- `CORS_ORIGINS`
- `COOKIE_SECURE`, `AUTH_COOKIE_NAME`
- `TRUSTED_PROXY_CIDRS` (leave empty unless requests arrive through a known proxy)
- `LIVEKIT_WS_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `LIVEKIT_NODE_IP` (set to server public IPv4 in production; optional in local dev)
- `VITE_API_URL`
- `VITE_GIPHY_API_KEY` (optional public client key; enables live GIF search and trending results)

## Common Commands

### Backend (`apps/server`)

```bash
cargo check
cargo test
cargo run
```

### Desktop (`apps/desktop/src-tauri`)

Requires a built `apps/web/dist` (Tauri embeds it at compile time):

```bash
cargo check --locked
cargo test --locked
```

### Frontend (`apps/web`)

```bash
npm ci
npm run lint
npm run build
npm run check:initial-bundle
npm run dev
```

### E2E / custom scripts (`apps/web`)

```bash
npm run test:e2e
npm run smoke:e2e
npm run chaos:reconnect
npm run regression:multi-user
npm run load:realtime
npm run rate-limit:check
```

Appearance changes must follow the semantic token and startup rules in [THEMING.md](THEMING.md).

Desktop bandwidth investigations must use the scenario controls and diagnostics
in [NETWORK_USAGE_BENCHMARK.md](NETWORK_USAGE_BENCHMARK.md).

## CI Workflows

### `.github/workflows/ci.yml`

Runs on `push` and `pull_request`:

- `Secret Scan (gitleaks)` (containerized CLI), on every run
- `Detect Changes` decides which build checks a change needs (`.github/scripts/ci-changes.mjs`, covered by `ci-changes.test.mjs`)
- `Backend` (`cargo check`, then unit and integration tests against isolated PostgreSQL and Redis services)
- `Frontend` (`npm ci`, lint, tests, `scripts/tests` and `.github/scripts` regressions, Playwright smoke coverage, production build, and the initial JavaScript budget check)
- `Desktop` (Ubuntu 22.04: Linux launcher validation, then `cargo check --locked` and `cargo test --locked` for the Tauri app against a placeholder frontend), so desktop compile errors fail the PR instead of the release build

Backend service containers pull pinned PostgreSQL and Redis versions from Docker Official Images on Amazon ECR Public (`public.ecr.aws/docker/library/`). This avoids Docker Hub pull quotas without requiring registry secrets, including for fork pull requests. Keep version tags pinned when updating these images.

Backend runs for `apps/server/` changes, Desktop for `apps/desktop/` and its launcher/QA-config scripts, and Frontend for everything else that is not documentation, plus the server and desktop files its validators read. Documentation-only changes (`*.md`, `docs/`, `LICENSE`, issue templates) skip all three. Changes to `ci.yml`, tags, manual runs and pushes without a known base run everything, and a failed detection also runs everything. Skipped jobs report success, so required checks never block on an unaffected area.

### `.github/workflows/dependency-security.yml`

Runs every Monday at 04:00 UTC, on manual dispatch, and on every PR:

- Rust dependency audit (`cargo audit`)
- Web production dependency audit (`npm audit --omit=dev --audit-level=high`)

## Notes

- Permission changes should update: `docs/API.md`, `docs/DATABASE.md`, `docs/WEBSOCKET_EVENTS.md`, and `docs/SECURITY.md`.
- If behavior changes and docs are not updated in same PR, treat it as drift.

---

Last verified against code on 2026-08-08.
