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
npm run test:e2e:ui
npm run test:e2e:headed
```

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
  - Frontend lint/build
- `.github/workflows/dependency-security.yml`
  - Rust and npm dependency audits

---

Last verified against code on 2026-03-14.
