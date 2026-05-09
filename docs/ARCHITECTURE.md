# Architecture

Voxpery is a real-time communication stack: Rust backend + React frontend + LiveKit SFU.

## Stack

| Layer | Technology |
|---|---|
| Backend | Rust, Axum, SQLx |
| Database | PostgreSQL 16+ |
| Cache/Coordination | Redis (JWT blacklist, distributed rate limiting, WS event bus) |
| Frontend | React 19, TypeScript, Vite, Zustand |
| Voice | LiveKit |
| Realtime signaling | WebSocket |
| Desktop | Tauri 2 |

## High-Level Data Flow

1. Auth: user logs in, backend issues JWT.
2. Web session uses httpOnly cookie; desktop uses Bearer token.
3. Client subscribes to channels via WS.
4. Message CRUD goes through REST; backend broadcasts updates over WS.
5. Voice permission and presence state are coordinated over WS.
6. Media path itself is LiveKit (backend only issues token).

## Backend Structure

`apps/server/src`:

- `routes/` REST endpoints (`auth`, `servers`, `channels`, `messages`, `friends`, `dm`, `webrtc`)
- `ws/` websocket protocol and handlers
- `services/permissions.rs` role bitmask + effective channel/category calculations
- `services/rate_limit.rs` Redis sliding-window limiter
- `ws/bus.rs` Redis Pub/Sub bridge for cross-instance WS event fan-out
- `middleware/auth.rs` token extraction and auth guards

## Permission Model

- Server permissions come from implicit `Everyone` + assigned roles.
- Effective channel permissions:
  - server bitmask
  - category overrides (deny then allow)
  - channel overrides (deny then allow)
- Server owner is full-access override.

## Realtime Model

- `tokio::broadcast` is used for each process-local fan-out stream.
- Redis Pub/Sub bridges broadcast and targeted user WS events between backend instances.
- Per-user active WS sessions are stored in-memory (`DashMap`) on the instance that owns each socket; REST list endpoints that derive online/offline from this map are instance-local until presence is externalized.
- Voice session/control state is still tracked in-memory for low-latency UI sync; run sticky WebSocket routing for multi-instance voice until this state is moved to Redis or another shared coordinator.

## Security Model (Implemented)

- JWT: HS256, expiration-based.
- Password hashing: Argon2id.
- CORS: explicit allowlist only, wildcard rejected.
- Cookie security guardrails enforced at startup.
- Redis-backed rate limits for auth, messaging, and WS connect.
- Permission checks applied on REST and WS access paths.
- WS event fan-out is authorization-aware at delivery time (current visibility/membership re-check).

## Deployment Topology

- Backend is a Rust binary.
- Frontend is static assets.
- Postgres + Redis + LiveKit are external services (docker-compose in dev/self-host).
- Multiple backend instances can share REST traffic and receive cross-instance WS event fan-out through Redis.
- For multi-instance voice/signaling, use sticky routing on `/ws` until voice session/control state is externalized.

---

Last verified against code on 2026-05-09.
