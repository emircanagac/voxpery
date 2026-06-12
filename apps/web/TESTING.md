# Voxpery Testing

This file describes current practical test commands.

## Frontend (`apps/web`)

```bash
npm ci
npm run lint
npm run build
```

Unit/integration (Vitest):

```bash
npm test
npm run test:run
npm run test:coverage
```

E2E (Playwright):

```bash
npm run test:e2e
npm run test:e2e:ui-smoke
npm run test:e2e:mobile-smoke
npm run test:e2e:ui
npm run test:e2e:headed
```

Mocked core UI smoke:

```bash
npm run test:e2e:ui-smoke
```

This Playwright suite runs against the real Vite UI with mocked API and WebSocket
responses, so it does not require a backend. Use it as the fast PR guard for
Friends, Requests, DM, server chat, channel creation, quick switcher, message
actions, voice settings, voice error recovery, and responsive shell regressions.

Mocked mobile web smoke:

```bash
npm run test:e2e:mobile-smoke
```

This suite runs the core Social, DM, server chat, mobile composer actions, and
mobile member sheet flows with the `mobile-chromium` Playwright project. It is
kept separate from the broader desktop smoke so mobile regressions can be run
explicitly in CI and release candidate checks without requiring a real phone.

## Backend (`apps/server`)

```bash
cargo check
cargo test
```

Note:

- Some rate-limit tests are intentionally ignored by default (Redis-dependent).

## End-to-end local sanity flow

```bash
# terminal 1
cd apps/server && cargo run

# terminal 2
cd apps/web && npm run dev
```

Then run either Playwright or scripted smoke checks:

```bash
cd apps/web
npm run smoke:e2e
```

## CI Mapping

Current workflows:

- `.github/workflows/ci.yml`
  - Secret scan
  - Backend check/tests
  - Frontend lint/unit tests/core UI smoke/mobile web smoke/build
- `.github/workflows/release-smoke.yml`
  - API smoke
  - Optional web E2E scope: desktop Chromium, mobile Chromium, or all browser projects
- `.github/workflows/release-desktop.yml`
  - Desktop release preflight
  - Tauri build
  - Platform artifact guard for installer packages, updater metadata, and signatures
- `.github/workflows/dependency-security.yml`
  - Rust and npm dependency audits

---

Last verified against code on 2026-06-12.
