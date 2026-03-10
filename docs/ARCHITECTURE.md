# Architecture

Voxpery is a full-stack real-time communication platform with voice, text, presence, and screen sharing.

## Stack Overview

| Layer       | Technology                              |
|-------------|-----------------------------------------|
| Backend     | Rust, Axum, SQLx                        |
| Database    | PostgreSQL 16                           |
| Cache       | Redis (JWT blacklist)                   |
| Frontend    | React 19, TypeScript, Vite 7, Zustand   |
| Voice (SFU) | LiveKit (WebRTC media server)           |
| Real-time   | WebSocket (presence, typing, messages)  |
| Auth        | JWT (Bearer for desktop, httpOnly cookie for web) |
| Desktop     | Tauri 2 (Rust + embedded webview)       |

## High-Level Architecture

```
┌─────────────────┐         WebSocket (presence, events)
│   Web Client    │◄─────────────────────────────────────┐
│  React + Vite   │         REST API (auth, CRUD)        │
└─────────────────┘◄─────────────────────────────────────┤
        │                                                 │
        │ LiveKit Client SDK                              │
        │ (WebRTC media)                                  │
        ▼                                                 │
┌─────────────────┐                              ┌───────▼────────┐
│  LiveKit SFU    │                              │  Axum Backend  │
│   (Voice/Video) │                              │  Rust + SQLx   │
└─────────────────┘                              └───────┬────────┘
                                                         │
                                         ┌───────────────┼───────────────┐
                                         ▼               ▼               ▼
                                   PostgreSQL         Redis       Broadcast
                                   (main data)     (JWT blacklist)  Channel
```

## Project Structure

```
voxpery/
├── apps/
│   ├── server/          # Rust backend (Axum)
│   │   ├── src/
│   │   │   ├── main.rs           # Entry point
│   │   │   ├── lib.rs            # App state, router
│   │   │   ├── config.rs         # Environment config
│   │   │   ├── routes/           # REST endpoints
│   │   │   │   ├── auth.rs       # Login, register, JWT
│   │   │   │   ├── servers.rs    # Server CRUD
│   │   │   │   ├── channels.rs   # Channel management
│   │   │   │   ├── messages.rs   # Server messages
│   │   │   │   ├── friends.rs    # Friend system
│   │   │   │   ├── dm.rs         # Direct messages
│   │   │   │   └── webrtc.rs     # TURN creds, LiveKit token
│   │   │   ├── ws/               # WebSocket handlers
│   │   │   │   ├── handler.rs    # WS upgrade, message dispatch
│   │   │   │   ├── mod.rs        # Event types (WsEvent, WsClientMessage)
│   │   │   │   └── access.rs     # Authorization (can_subscribe, can_join_voice)
│   │   │   ├── middleware/       # Auth middleware
│   │   │   ├── services/         # Business logic
│   │   │   ├── models/           # DB models
│   │   │   └── errors.rs         # Error handling
│   │   └── migrations/           # SQL migrations
│   ├── web/             # React frontend
│   │   ├── src/
│   │   │   ├── main.tsx          # Entry point
│   │   │   ├── App.tsx           # Root component, routing
│   │   │   ├── api.ts            # API client
│   │   │   ├── stores/           # Zustand state
│   │   │   ├── pages/            # Route components
│   │   │   ├── components/       # UI components
│   │   │   └── webrtc/           # Voice hooks (useLiveKitVoice)
│   │   └── scripts/              # E2E test scripts
│   └── desktop/         # Tauri 2 desktop app
│       └── src-tauri/
├── docker-compose.yml   # Postgres + Redis + LiveKit
└── docs/                # This folder
```

## Key Components

### Backend (Rust)

- **Axum router** — REST API with middleware (auth, rate limit, CORS)
- **SQLx** — Async PostgreSQL driver with compile-time query checking
- **Tokio broadcast** — In-memory pub/sub for WebSocket events
- **DashMap** — Concurrent HashMap for active sessions, voice state, rate limits

### Frontend (React)

- **Vite** — Fast dev server and build tool
- **Zustand** — Lightweight state management (auth, app state, socket)
- **React Router** — SPA routing
- **LiveKit Client SDK** — WebRTC voice/video client
- **Tauri plugin HTTP** — Secure fetch for desktop (bypasses CORS, no cookie leakage)

### Real-Time

- **WebSocket** — Bidirectional events (typing, presence, voice state, messages)
- **LiveKit SFU** — Selective Forwarding Unit for voice/video (N:M topology, not mesh)
- **Broadcast channel** — Backend in-memory pub/sub distributes events to all connected clients

### Data Flow

1. **Auth**: User logs in → backend mints JWT → web stores in httpOnly cookie, desktop stores in secure keyring
2. **WebSocket**: Client connects with JWT (cookie or Bearer) → subscribes to channels → receives events
3. **Voice**: User joins voice channel → backend mints LiveKit token → client connects to LiveKit SFU → audio/video flows peer-to-peer via SFU
4. **Messages**: User sends message via REST → backend stores in DB → broadcasts `NewMessage` event via WS → all subscribed clients receive

## Deployment

- **Database**: PostgreSQL 16+ (required for all features)
- **Cache**: Redis 7+ (JWT blacklist; future: multi-pod rate limit)
- **Voice**: LiveKit self-hosted or Cloud (required for voice/video)
- **Backend**: Single binary (`cargo build --release`), runs as systemd service
- **Frontend**: Static files (`npm run build`), served via nginx

## Security

- **Auth**: JWT with RS256 or HS256; httpOnly cookie for web (XSS-safe)
- **CORS**: Explicit origin whitelist; `*` rejected at startup
- **Cookie**: `Secure` flag enforced for non-local origins
- **Rate limit**: Per-route in-memory counters (auth: 10/min, messages: 30/10s)
- **Input validation**: All user input sanitized before DB insertion

## Performance

- **Concurrency**: Tokio async runtime; hundreds of concurrent WS connections per core
- **Broadcasting**: Tokio broadcast channel with lazy deserialization
- **Voice**: LiveKit SFU handles media forwarding; backend only issues tokens
- **Database**: Connection pool (max 20); prepared statements cached
