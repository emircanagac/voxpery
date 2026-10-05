# Development

Local setup, scripts, and CI behavior for current codebase.

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
docker compose up -d postgres redis livekit
```

This development flow uses Docker Compose for supporting services only. If you want the full stack in containers, use `docker compose up -d --build` instead and do not start the backend/frontend locally on the same ports.

ClamAV is optional in development. To run it locally, start it explicitly:

```bash
docker compose --profile security up -d clamav
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

### Local QA (Windows + WSL)

Use the ignored root `.env` as the single configuration source. `node scripts/local-qa.mjs init` checks it without printing credentials or creating another environment file. Use development credentials and, for automated CAPTCHA tests, official Turnstile test keys; never use test keys in production. The launcher rejects production mode.

In a running WSL distribution with Docker Engine/Compose installed, start only supporting services:

```bash
cd /mnt/d/project_codes/voxpery
docker compose --env-file .env -p voxpery-qa up -d postgres redis livekit
```

The fixed container names/ports in Compose must be free. PostgreSQL and Redis bind to loopback; LiveKit also exposes media ports. Keep WSL running while testing native Windows clients so localhost forwarding remains available. The Compose project isolates volumes from other project names.

In separate Windows terminals at the repository root:

```powershell
node scripts/local-qa.mjs backend
node scripts/local-qa.mjs frontend
```

Open `http://localhost:5173/register`. Backend health is `http://localhost:3001/health`. This is Docker infrastructure plus native development servers, not production containers. The launcher maps Compose database/Redis hostnames to localhost and derives a native database URL from `POSTGRES_USER/PASSWORD/DB` when `DATABASE_URL` is absent. Existing PostgreSQL volumes retain their initialized password; changing `.env` alone does not change the database role. Register disposable local accounts. Email delivery follows the root SMTP configuration.

Backend tests default to a separate database named `<POSTGRES_DB>_tests` (create it before `node scripts/local-qa.mjs backend-test -- --test-threads=1`) and Redis database 1; explicit `TEST_DATABASE_URL/TEST_REDIS_URL` override these defaults. Never point tests at the application or production database. The Compose PostgreSQL bootstrap role is development-only; use separately provisioned, least-privilege database roles for deployment.

For real Google testing, configure development `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in root `.env`, authorize `http://localhost:3001/api/auth/google/callback` in Google Console, and restart the backend. Google remains disabled without credentials. Integration fixtures validate the pending-registration transaction and PKCE exchange without pretending to validate Google's upstream flow.

For desktop QA, keep the frontend running and use `node scripts/local-qa.mjs desktop` from the repository root with the Tauri CLI installed. This loads root `.env` and runs `cargo tauri dev --config tauri.dev.conf.json` in `apps/desktop/src-tauri`. Use only the development config; never broaden release CSP/capabilities for local testing. A packaged production desktop app does not automatically connect to this local backend.

After auth/media changes, run the normal lint/unit/build checks, the CI core and mobile smoke scripts with `--workers=1`, and:

```bash
npx playwright test e2e/auth-core-regressions.spec.ts e2e/voice-media-regressions.spec.ts e2e/floating-stream-regressions.spec.ts --project=chromium --workers=1
```

Keep root `.env` local and untracked.

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

- `Secret Scan (gitleaks)` (containerized CLI)
- `Backend` (`cargo check`, then unit and integration tests against isolated PostgreSQL and Redis services)
- `Frontend` (`npm ci`, lint, tests, Playwright smoke coverage, production build, and the initial JavaScript budget check)

### `.github/workflows/dependency-security.yml`

Runs every Monday at 04:00 UTC, on manual dispatch, and on every PR:

- Rust dependency audit (`cargo audit`)
- Web production dependency audit (`npm audit --omit=dev --audit-level=high`)

## Notes

- Permission changes should update: `docs/API.md`, `docs/DATABASE.md`, `docs/WEBSOCKET_EVENTS.md`, and `docs/SECURITY.md`.
- If behavior changes and docs are not updated in same PR, treat it as drift.

---

Last verified against code on 2026-08-08.
