# Development

Local development setup, debugging, testing, and CI/CD.

## Prerequisites

- **Rust**: 1.75+ (`rustup update`)
- **Node.js**: 20+ (`node -v`)
- **Docker**: For Postgres + Redis + LiveKit (`docker --version`)
- **Git**: For version control

## Quick Start

1. **Clone**:
   ```bash
   git clone https://github.com/emircanagac/voxpery.git
   cd voxpery
   ```

2. **Environment**:
   ```bash
   cp .env.example .env
   # Edit .env: set DATABASE_URL, JWT_SECRET, LIVEKIT_* (see below)
   ```

3. **Infrastructure**:
   ```bash
   docker compose up -d
   # Starts Postgres, Redis, LiveKit
   ```

4. **Backend**:
   ```bash
   cd apps/server
   cargo run
   # Listens on http://127.0.0.1:3001
   ```

5. **Frontend**:
   ```bash
   cd apps/web
   npm ci
   npm run dev
   # Open http://localhost:5173
   ```

## Environment Variables

Root `.env` file (used by backend, frontend, docker-compose):

```bash
# Database
DATABASE_URL=postgres://voxpery:password@localhost:5432/voxpery
POSTGRES_USER=voxpery
POSTGRES_PASSWORD=password  # Change in production
POSTGRES_DB=voxpery

# Redis
REDIS_URL=redis://localhost:6379

# Backend
SERVER_HOST=0.0.0.0  # Or 127.0.0.1 for localhost-only
SERVER_PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-me  # Use `openssl rand -base64 32`
JWT_EXPIRATION=86400  # 24 hours in seconds
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,tauri://localhost
COOKIE_SECURE=0  # Set to 1 for HTTPS (production)
AUTH_COOKIE_NAME=voxpery_token

# Rate limits
AUTH_RATE_LIMIT_MAX=10  # Auth requests per window
AUTH_RATE_LIMIT_WINDOW_SECS=60
MESSAGE_RATE_LIMIT_MAX=30  # Messages per window
MESSAGE_RATE_LIMIT_WINDOW_SECS=10

# Optional: Seed admin (auto-created on startup)
ADMIN_EMAIL=admin@example.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123  # Change me

# LiveKit (voice)
LIVEKIT_WS_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret_please_change_me_32_chars  # Must match docker-compose.yml

# TURN (optional, for NAT traversal)
TURN_URLS=turn:turn.example.com:3478
TURN_SHARED_SECRET=your-turn-secret
TURN_CREDENTIAL_TTL_SECS=3600

# Optional: Google OAuth (Sign in with Google). If unset, the button is shown but returns 503.
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
# Public base URL of this API (for OAuth redirect_uri). Use same host as frontend in dev so the auth cookie is sent:
# if frontend is http://localhost:5173, set PUBLIC_API_URL=http://localhost:3001 (not 127.0.0.1).
PUBLIC_API_URL=http://localhost:3001

# Frontend
VITE_API_URL=http://127.0.0.1:3001
```

**Important**:
- `JWT_SECRET`: Generate with `openssl rand -base64 32`
- `LIVEKIT_API_SECRET`: Must match `keys` in LiveKit config (see `docker-compose.yml`)
- `CORS_ORIGINS`: Comma-separated list; never use `*` in production

## Scripts

### Backend

```bash
cd apps/server

# Check without building
cargo check

# Format code
cargo fmt

# Run tests (unit)
cargo test --lib

# Run tests (integration, requires DB)
DATABASE_URL=postgres://... cargo test --test integration

# Build release
cargo build --release
# Binary: target/release/voxpery-server
```

### Frontend

```bash
cd apps/web

# Install deps
npm ci

# Dev server
npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Build for production
npm run build
# Output: dist/
```

### Desktop (Tauri)

```bash
# Build frontend first
cd apps/web
npm run build

# Build Tauri desktop app
cd ../desktop
cargo tauri build --debug
# Binary: src-tauri/target/debug/voxpery
```

## Testing

### End-to-End Tests

Test scripts in `apps/web/scripts/`:

- **smoke-e2e.mjs**: Register, login, create server, send message
- **chaos-reconnect.mjs**: Simulate WS reconnection
- **regression-multi-user.mjs**: Multi-user voice scenario
- **rate-limit-check.mjs**: Rate limit validation

**Run**:
```bash
cd apps/web
node scripts/smoke-e2e.mjs
```

**Prerequisites**: Backend + Postgres must be running.

### Unit Tests

**Backend**:
```bash
cd apps/server
cargo test --lib  # No DB required
```

**Frontend**: No unit tests yet (PRs welcome).

### Integration Tests

```bash
cd apps/server
DATABASE_URL=postgres://test_user:test_pass@localhost:5432/voxpery_test cargo test --test integration
```

**Setup test DB**:
```bash
psql -U postgres -c "CREATE DATABASE voxpery_test;"
psql -U postgres -c "CREATE USER test_user WITH PASSWORD 'test_pass';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE voxpery_test TO test_user;"
```

## Debugging

### Backend

**Enable debug logs**:
```bash
RUST_LOG=voxpery_server=debug,tower_http=debug cargo run
```

**Levels**: `error`, `warn`, `info`, `debug`, `trace`

**WebSocket debugging**:
- Backend logs: `tracing::info!("WebSocket connected: {} ({})", username, user_id)`
- Frontend console: `useSocketStore.subscribe((event) => console.log('[WS]', event))`

**Database queries**:
```bash
psql -U voxpery -d voxpery
voxpery=# SELECT * FROM users;
```

### Frontend

**Browser DevTools**:
- **Console**: View logs, errors, WS messages
- **Network → WS**: Inspect WebSocket frames
- **Application → Cookies**: Check `voxpery_token` (httpOnly, not readable from JS)
- **Application → Local Storage**: Voice settings, persistent state

**React DevTools**: Install extension for component tree inspection.

**Zustand DevTools**:
```typescript
// In store
import { devtools } from 'zustand/middleware'
export const useAppStore = create(devtools(...))
```

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):

1. **Backend**:
   - `cargo fmt --check`
   - `cargo check`
   - `cargo test --lib`
2. **Frontend**:
   - `npm ci`
   - `npm run build`
3. **Smoke test** (with Postgres):
   - Start Postgres container
   - Run backend
   - Run `smoke-e2e.mjs`

**Merge policy**: CI must pass before merging PR.

## Common Issues

### "Failed to connect to database"

- Check Postgres is running: `docker ps | grep postgres`
- Verify DATABASE_URL in `.env`
- Check credentials: `psql -U voxpery -h localhost -d voxpery`

### "WebSocket is not connected"

- Check backend is running: `curl http://127.0.0.1:3001/health`
- Verify CORS_ORIGINS includes frontend origin
- Check browser console for WS connection errors

### "No microphone device detected"

- Grant browser permission (chrome://settings/content/microphone)
- Check OS settings: System Preferences → Sound → Input
- Try another browser

### "LiveKit connection timeout"

- Check LiveKit is running: `docker ps | grep livekit`
- Verify LIVEKIT_API_KEY and LIVEKIT_API_SECRET match in `.env` and `docker-compose.yml`
- Check backend logs: `Failed to sign LiveKit token`

### "CORS error"

- Add frontend origin to CORS_ORIGINS in `.env`
- Restart backend after changing `.env`
- Check `Access-Control-Allow-Origin` in Network tab

## Performance Profiling

**Backend (CPU)**:
```bash
cargo install flamegraph
cargo flamegraph --bin voxpery-server
# Open flamegraph.svg
```

**Frontend (React)**:
```bash
npm run build -- --profile
# Use React DevTools Profiler tab
```

**Database**:
```sql
-- Enable query logging
ALTER SYSTEM SET log_statement = 'all';
SELECT pg_reload_conf();

-- Analyze slow queries
SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

## Code Style

- **Rust**: `rustfmt` (runs via `cargo fmt`)
- **TypeScript**: ESLint + Prettier (use `npm run lint`)
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)

## Documentation

- **Update docs/** when changing architecture or adding features
- **Inline comments**: Focus on "why", not "what"
- **README**: Keep quick start up-to-date

## Release Process

1. Bump version in `Cargo.toml` (backend) and `package.json` (frontend)
2. Update CHANGELOG.md
3. Tag release: `git tag v1.x.0 && git push --tags`
4. GitHub Actions builds release artifacts
5. Deploy to production server (see [Deployment](#deployment))

## Deployment

**Backend**:
```bash
cargo build --release
scp target/release/voxpery-server user@server:/opt/voxpery/
ssh user@server 'sudo systemctl restart voxpery'
```

**Frontend**:
```bash
npm run build
rsync -avz dist/ user@server:/var/www/voxpery/
```

**Full guide**: See [Deployment Guide](DEPLOYMENT.md).
