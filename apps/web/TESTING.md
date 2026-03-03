# Voxpery Test Suite

Comprehensive test coverage for frontend, backend, and E2E flows.

## Test Types

### 1. Frontend Unit Tests (Vitest)
**Location:** `apps/web/src/**/*.{test,spec}.{ts,tsx}`

```bash
cd apps/web

# Run tests in watch mode
npm test

# Run tests once
npm run test:run

# Run with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

**Current Coverage:**
- API error handling (6 tests)
- WebSocket store with reconnection (9 tests)
- Error boundary component (2 tests)
- Secure storage utilities (2 tests)
- **Total: 19 unit tests passing**

### 2. Backend Unit Tests (Rust)
**Location:** `apps/server/src/**/*` (inline `#[cfg(test)]` modules)

```bash
cd apps/server

# Run all tests
cargo test

# Run specific test
cargo test auth::tests::hash_and_verify_password_roundtrip

# Run with output
cargo test -- --nocapture
```

**Current Coverage:**
- Auth service (3 tests): password hashing, JWT generation, invite codes
- Attachment validation (9 tests): URL validation, data URLs, XSS prevention
- Rate limiting (3 tests): request throttling, window expiration
- CORS/security validation (5 tests): Tauri local access, cookie security
- WebSocket origin validation (3 tests)
- Error handling (1 test): HTTP status codes
- **Total: 24 unit tests passing**

### 3. E2E Tests (Playwright)
**Location:** `apps/web/e2e/*.spec.ts`

```bash
cd apps/web

# Run E2E tests (requires backend running)
npm run test:e2e

# Run with UI mode (great for debugging)
npm run test:e2e:ui

# Run headed (see browser)
npm run test:e2e:headed
```

**Prerequisites:**
- Backend server running: `cd apps/server && cargo run`
- Database & Redis: `docker compose up -d`
- Frontend dev server will auto-start via Playwright config

**Current E2E Specs:**
- `auth.spec.ts` (7 tests): Login redirect, form validation, navigation
- `auth-integration.spec.ts` (9 tests): Full registration flow, session persistence across reloads/browser restarts, WebSocket connection verification
- `crud-flows.spec.ts` (9 tests): Server/channel creation, messaging (send/edit/delete), pagination, channel switching
- `friends.spec.ts` (4 tests): Friend requests (send/accept/reject), DM messaging, friend removal
- `navigation.spec.ts` (5 tests): Routing, branding, connection gate, 404 handling
- **Total: 34+ E2E test scenarios**

## Test Strategy

### What's Tested
✅ **Frontend:**
- Utility functions (API error parsing, Tauri detection)
- React components (ErrorBoundary)
- WebSocket store (connection, reconnection, message handling)
- Critical user flows (E2E: auth, CRUD, friends, DMs)

✅ **Backend:**
- Authentication (Argon2 hashing, JWT)
- Security (CORS, rate limiting, XSS prevention)
- Data validation (attachments, WebSocket origins)

✅ **Integration (E2E):**
- Complete auth flows (register → login → session persistence)
- Server/channel/message CRUD operations
- Friend requests and direct messaging
- Real-time WebSocket events
- Multi-user scenarios (2 simultaneous browser contexts)

### What's NOT Tested (Production Gaps)
⚠️ **Voice/WebRTC:** No automated tests for voice channel join/leave, mute/unmute, screen sharing
⚠️ **LiveKit:** Real SFU connection and media stream testing requires integration environment
⚠️ **Load Testing:** Multi-user voice scenarios, concurrent connections
⚠️ **Desktop:** Tauri-specific functionality (auto-updater, secure storage, system tray)

> **Note**: WebRTC unit tests were intentionally excluded due to complex mocking requirements. E2E voice tests should be added when integration environment is available.

## CI Integration

Add to `.github/workflows/test.yml`:

```yaml
name: Test

on: [push, pull_request]

jobs:
  frontend-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: cd apps/web && npm ci
      - run: cd apps/web && npm run test:run

  backend-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cd apps/server && cargo test

  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: testpass
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cd apps/server && cargo build --release
      - run: cd apps/web && npm ci
      - run: cd apps/web && npx playwright install chromium
      - run: DATABASE_URL=postgres://postgres:testpass@localhost:5432/voxpery cd apps/server && cargo run &
      - run: cd apps/web && npm run test:e2e
```

## Writing Tests

### Frontend (Vitest)
```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

describe('MyComponent', () => {
  it('should render hello', () => {
    render(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

### Backend (Rust)
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = my_function();
        assert_eq!(result, expected);
    }
}
```

### E2E (Playwright)
```typescript
import { test, expect } from '@playwright/test'

test('user can login', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', 'user@example.com')
  await page.fill('input[type="password"]', 'password')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL('/app/friends')
})
```

## Debugging

### Frontend Tests
```bash
npm test -- --reporter=verbose
npm run test:ui  # Visual UI for debugging
```

### Backend Tests
```bash
cargo test -- --nocapture  # Show println! output
RUST_LOG=debug cargo test  # Enable logging
```

### E2E Tests
```bash
npm run test:e2e:headed  # See browser actions
npm run test:e2e:ui      # Interactive debug mode
PWDEBUG=1 npm run test:e2e  # Step through with debugger
```

## Coverage Goals

| Component | Current | Target |
|-----------|---------|--------|
| Frontend Utils | ~30% | 80% |
| Frontend Components | ~10% | 70% |
| Backend Services | ~70% | 90% |
| E2E Critical Flows | ~20% | 80% |

---

**Status:** ✅ Test infrastructure complete. Incrementally add tests for new features.
