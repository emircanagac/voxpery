# Architecture

Voxpery is a real-time communication stack: a Rust backend, a React web client that the Tauri
desktop app also loads, and LiveKit for media. This page describes how the pieces fit together.
Interface behavior (scrolling, layout, menus, dialogs, the voice stage) is in
[UI_BEHAVIOR.md](UI_BEHAVIOR.md); endpoints, events and tables are in [API.md](API.md),
[WEBSOCKET_EVENTS.md](WEBSOCKET_EVENTS.md) and [DATABASE.md](DATABASE.md).

## Stack

| Layer | Technology |
|---|---|
| Backend | Rust, Axum, SQLx |
| Database | PostgreSQL 16 |
| Cache/Coordination | Redis 8 (JWT blacklist, distributed rate limiting, WS event bus, instance snapshots) |
| Frontend | React 19, TypeScript, Vite, Zustand |
| Voice and video | LiveKit (SFU) |
| Realtime signaling | WebSocket |
| File storage | Local disk or S3 compatible bucket; optional ClamAV scan |
| Desktop | Tauri 3 (alpha): system webview on Windows/macOS, Chromium (CEF) on Linux |

Versions of the bundled services are pinned in `docker-compose.yml`.

## High-Level Data Flow

1. Sign-in: the backend issues a JWT. The web client keeps it in an httpOnly cookie; the desktop app
   keeps a Bearer token in the operating system's credential store.
2. Desktop OAuth and email registration return through a PKCE-bound, single-use code
   (`/api/auth/desktop-exchange`), never a JWT in a URL.
3. Startup restores identity and legal-document status from one `GET /api/auth/session` snapshot
   (see Session And Legal Acknowledgements below).
4. Writes go through REST; the backend fans the resulting events out over WebSocket.
5. The client subscribes to the channels it shows; voice presence and controls travel over the same
   WebSocket.
6. Media flows through LiveKit; the backend only issues scoped, expiring room tokens and removes
   participants when access ends.

## Backend Structure

`apps/server/src`:

- `routes/` REST endpoints, one module per area: authentication and accounts (`auth*`,
  `google_registration`, `desktop_registration`, `registration_pages`, `captcha_frame`), servers and
  moderation (`servers*`), `channels`, `messages`, `dm`, `friends`, `user_notes`, `attachments`,
  `images` (avatar and image proxy), `webrtc` (LiveKit tokens), `releases` and `system` (public
  feature flags, observability intake).
- `ws/` the WebSocket protocol: `handler` (connections, subscriptions), `voice_commands`, `access`
  (channel access cache), `audience` (who receives a broadcast event), `bus` (Redis Pub/Sub bridge),
  `cluster` (state shared between instances).
- `services/` shared logic: `registration` (every account creation path), `permissions` (role bitmask and effective channel/category permissions),
  `rate_limit` (Redis sliding window), `shared_redis`, `jwt_blacklist`, `auth`, `privacy` (legal
  documents, data export), `attachments` and `object_storage`, `moderation`, `automod`, `audit`,
  `voice_revoke` and `voice_moderation`, `metrics`, `observability`.
- `middleware/` `auth` (token extraction, session and legal-consent guards), `csrf`
  (cookie-authenticated writes), `security_headers`.
- `migrations/` SQL migrations, applied at startup and immutable once merged.

## Session And Legal Acknowledgements

Application startup restores identity and legal-document status through one authenticated `GET /api/auth/session` snapshot. The auth store coalesces concurrent bootstrap requests, holds the status only in memory, and ignores late success/error responses after logout or account changes. Persisted profiles are display hints, not proof of authentication or acceptance. App routes wait for this snapshot; public auth/legal pages remain available during outages. Session failures have explicit retry/logout actions rather than implying missing acknowledgement.

The legal boundary consumes the startup snapshot without another request or a separate document loader. A server `428`/WebSocket consent signal invalidates the in-memory snapshot and refreshes the status; explicit acceptance updates the same session. Backend API/WS gates remain authoritative, including after document-version changes. Each hard refresh still validates the session once; caching acceptance across reloads is intentionally avoided.

The server supplies current legal-document versions through public metadata. Sign Up and the authenticated consent boundary share the same acknowledgement component; load failure is separate from missing consent, and failed saves preserve valid selections. Gate state is keyed to the authenticated identity and ignores stale requests.

Only the official service publishes the hosted documents; it is recognized from `PUBLIC_API_URL` or `FRONTEND_URL`. Any other server is a separate controller: it names its own documents with the `LEGAL_*` variables, keeps a fixed default version until `LEGAL_DOCUMENTS_VERSION` is set, and its legal pages never show the hosted text. The desktop app accepts only web addresses from a server and treats any custom server as self-hosted.

Google callbacks require a verified provider email. Existing accounts keep the normal sign-in path and acknowledge only missing/stale versions. New accounts arriving with valid Sign Up metadata use the fast path; otherwise a cookie-bound pending context leads to a server-rendered completion form. Both paths use the same transaction-level account/audit creation service. Pending completion additionally locks and consumes its short-lived context atomically. No account or full session is issued before actual acknowledgement. Desktop results remain PKCE-bound single-use exchange codes; the browser completion page has no native IPC access.

Every account is created by `services/registration.rs`, whichever path the sign-up took (email, desktop or Google). It applies the server's registration mode (`REGISTRATION_MODE`: open, invite or closed), the shared rate limits, CAPTCHA and field rules, and stores the account with its legal acknowledgement proof; an invite-only sign-up joins the inviting server in the same transaction. The default community invite code never counts as an invitation.

## Permission Model

- Server permissions come from implicit `Everyone` + assigned roles.
- Effective channel permissions:
  - server bitmask
  - category overrides, then channel overrides; at each level the `Everyone` override first, then the member's role overrides together (each step deny before allow). An `Everyone` allow does not undo a deny on one of the member's roles; one role's allow still lifts another role's deny.
- Server owner is full-access override.
- Membership comes first: a non-member gets no permissions from any role or override, including `Everyone`. WebSocket subscriptions, event delivery, voice access, attachments and channel member lists all use this computation, so leaving, kicks and bans take effect on existing connections too.
- Overrides only carry channel-scoped bits (`Permissions::CHANNEL_OVERRIDABLE`); server-wide powers such as `MANAGE_SERVER`, `MANAGE_ROLES`, `KICK_MEMBERS`, `BAN_MEMBERS` and `VIEW_AUDIT_LOG` cannot be granted or removed per channel.
- Role and permission management (roles, role order, member role assignment, category and channel overrides) is owner-only (`permissions::ensure_server_owner`). Channel managers can still edit channels and categories, and moderators keep the moderation permissions their roles give them. This separates managing a channel from managing who may do what, as Discord does with `MANAGE_ROLES` for channel permission edits.
- Rules for reintroducing delegated role management (not active today):
  - A non-owner may only create, edit or assign roles whose permissions are a subset of the caller's own effective server permissions, and never `MANAGE_SERVER`.
  - A non-owner may only create, edit, reorder, assign or remove roles strictly below their own highest role, and may not move any role to or above it.
  - A non-owner may not change their own roles.
  - Override edits require the same permission scope at the target channel and may only allow bits the caller holds there.
  - Taking over server ownership remains a separate, owner-only action; it is distinct from gaining management permissions.

## Realtime Model

- `tokio::broadcast` is used for each process-local fan-out stream.
- Requests share one multiplexed Redis connection (`services/shared_redis.rs`), which reconnects on its own after a Redis restart. Pub/Sub keeps a connection of its own.
- Redis Pub/Sub bridges broadcast and targeted user WS events between backend instances.
- A broadcast event carries its audience (`ws/audience.rs`): the first connection that needs it looks it up, and every other connection of the instance reads the same answer. The lookup runs once per event, so permissions are still checked at delivery while status, member and voice events cost a fixed number of queries however many clients are connected. Message and typing events keep the per-connection channel access cache.
- Per-user active WS sessions are stored in-memory (`DashMap`) on the instance that owns each socket. Each instance also knows what the others hold (`ws/cluster.rs`): voice and presence changes are applied from the Redis bus, and a short-lived snapshot in Redis brings a new instance up to date, repairs lost events and shows when an instance has died, so `/ws` needs no sticky routing.
- Unread counts, mentions and mutes of server channels are stored per account (`routes/notifications.rs`, `services/mentions.rs`): read marks only move forward, mentions by name are recorded when a message is sent or edited, and a `ChannelRead` event clears the badge in the reader's other sessions. Clients load the state at sign-in and after reconnecting, so nothing depends on having been connected when a message arrived. See [API.md](API.md#notifications).
- Web Push (`services/web_push.rs`, optional with VAPID keys) reaches recipients of a direct message or mention who have no open connection on any instance; the payload names the sender and conversation, never the message. See [API.md](API.md#push-notifications).

## Security Model (Implemented)

- JWT: HS256 only, with expiry, a per-user `token_version` (password changes and similar events end
  every session) and a `jti`; logout puts the token on a Redis blacklist.
- Password hashing: Argon2id.
- CORS: explicit allowlist only, wildcard rejected. Cookie-authenticated writes also pass an Origin
  check (`middleware/csrf.rs`).
- Cookie security guardrails are enforced at startup.
- Security headers on every API response: CSP, HSTS, `X-Frame-Options: DENY` (except the desktop
  CAPTCHA frame, which sets its own `frame-ancestors`), `X-Content-Type-Options: nosniff`.
- Redis-backed rate limits for authentication, registration, password reset, messaging, uploads,
  voice tokens and WebSocket connections and messages.
- Permission checks on REST and WebSocket paths; WebSocket fan-out re-checks visibility and
  membership at delivery time.
- Uploads are checked by content signature, stored under server-generated names and served only via
  signed URLs. Remote images load through the image proxy, which rejects private network addresses.
- Details and the hardening checklist: [SECURITY.md](SECURITY.md).

## Deployment Topology

- The backend is one Rust binary; the web client is static assets served by nginx.
- PostgreSQL, Redis and LiveKit run as separate services (Docker Compose for development and
  self-hosting); ClamAV is optional.
- Several backend instances can share REST traffic and receive cross-instance WebSocket fan-out
  through Redis. Voice and presence state are shared between instances, so `/ws` needs no sticky
  routing; see Realtime Model.
- On `SIGTERM` an instance stops taking connections, closes its WebSockets with `1012` so clients reconnect, lets running requests finish for up to 20 seconds and keeps voice sessions in place; 60 seconds after the next start it removes LiveKit participants whose user did not come back (`services/shutdown.rs`, `voice_revoke::reconcile_orphaned_voice_claims`). Compose gives it 30 seconds.
- Prometheus metrics are served on a separate, optional bind address. Deployment steps:
  [DEPLOYMENT.md](DEPLOYMENT.md).

## Public Web Routes

- On the web, `/` shows the landing page to signed-out visitors and redirects signed-in visitors to the application. Tauri keeps its existing login and application entry behavior, and the installed PWA keeps its `/` entry.
- `/about` always shows the public landing page. `/compare` is a public comparison page. Neither route requires a legal acknowledgement or backend connection before rendering.
- `/` and `/about` are served from `landing.html` and `/compare` from `compare.html`. Their first HTML response already carries the page title, summary, comparison table (on `/compare`), a `SoftwareApplication` JSON-LD block and a large social preview (`social-preview.png`), so search engines and link previews read them without running JavaScript. React replaces this static content on start. `/about` uses `/` as its canonical address because it shows the same page. `compareStaticHtml.test.ts` keeps the static comparison in step with `compareContent.ts`.
- For `/`, `/about` and `/compare`, `main.tsx` loads the page code (`src/pages/publicPageModules.ts`) before React starts, so the readable HTML turns straight into the page without the loading card. When `voxpery-auth` holds a remembered profile, `public/theme-init.js` marks `<html data-session-hint>` on `/`, `landing.html` hides its text, and the app shows the loading card while the session is checked instead of the landing page. The shared `<head>` lines and the `SoftwareApplication` JSON-LD live in `src/seo` and are filled into every HTML entry by a Vite plugin. nginx answers unknown paths with status 200, so the 404 page sets `robots` to `noindex` while it is shown.
- Application routes such as `/social` and `/servers` remain behind session validation, legal-document acknowledgement, and the connection gate.
- The production web server serves a distinct HTML entry for `/compare` so direct requests have the comparison page title, description, and canonical URL before JavaScript runs. Client-side navigation updates those tags as well.

---

Last verified against code on 2026-11-15 (`main` at `006f225`).
