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
  - Frontend lint/unit tests/core UI smoke/build
- `.github/workflows/dependency-security.yml`
  - Rust and npm dependency audits

---

Last verified against code on 2026-06-01.
