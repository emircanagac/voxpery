# API Reference

REST API for auth, servers, channels/categories, messages/reactions, friends, DMs, and voice tokening.

## Base URL

- Development: `http://127.0.0.1:3001`
- Production: your API domain (for example `https://api.example.com`)

## Authentication

- Web: httpOnly cookie (`voxpery_token` by default)
- Desktop: `Authorization: Bearer <jwt>`

## Authorization Model

Role/permission system is bitmask-based (`apps/server/src/services/permissions.rs`).

- `1 << 0` `VIEW_SERVER`
- `1 << 1` `MANAGE_SERVER`
- `1 << 2` `MANAGE_ROLES`
- `1 << 3` `MANAGE_CHANNELS`
- `1 << 4` `KICK_MEMBERS`
- `1 << 5` `BAN_MEMBERS`
- `1 << 6` `VIEW_AUDIT_LOG`
- `1 << 7` `SEND_MESSAGES`
- `1 << 8` `MANAGE_MESSAGES`
- `1 << 9` `MANAGE_PINS`
- `1 << 10` `CONNECT_VOICE`
- `1 << 11` `MUTE_MEMBERS`
- `1 << 12` `DEAFEN_MEMBERS`

Important behavior:

- Server owner is always effectively full-access.
- `Everyone` role is seeded by default per server and implicitly included for members.
- Effective channel permissions are computed as: server roles -> category overrides (deny then allow) -> channel overrides (deny then allow).

## Auth Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/status` (`status` values: `online`, `dnd`, `invisible`)
- `PATCH /api/auth/profile`
  - `dm_privacy` values: `everyone`, `friends`
- `GET /api/auth/check-username?username=...`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `GET /api/auth/data-export`
  - GDPR/KVKK data export JSON payload for authenticated user.
  - Export is intentionally user-readable: internal technical IDs (server/channel/message/friend IDs) are omitted.
- `DELETE /api/auth/account`
  - Body: `{ "confirm": "DELETE", "password"?: "..." }`
  - Permanently deletes account and authored content.

Notes:

- `forgot-password` always returns a generic success message to prevent account enumeration.
- For unknown email (or Google-only account), no reset email is sent.

## Server Endpoints

- `GET /api/servers`
- `POST /api/servers`
- `GET /api/servers/:server_id`
- `PATCH /api/servers/:server_id` (requires `MANAGE_SERVER`)
- `DELETE /api/servers/:server_id` (owner)
- `POST /api/servers/join`
- `POST /api/servers/:server_id/leave`
- `GET /api/servers/:server_id/channels`
  - Returns only channels visible to caller (`VIEW_SERVER` at effective channel scope).
  - Each item includes `my_permissions` bitmask.
- `GET /api/servers/:server_id/channels/:channel_id/members`
  - Returns only members who can view that channel.

### Roles

- `GET /api/servers/:server_id/roles`
  - Supports query `?include_system=true` to include `Everyone`.
- `POST /api/servers/:server_id/roles`
- `PATCH /api/servers/:server_id/roles/:role_id`
- `DELETE /api/servers/:server_id/roles/:role_id`
- `PATCH /api/servers/:server_id/roles/reorder`

### Member Role Assignment

- `GET /api/servers/:server_id/members/:user_id/roles`
- `PUT /api/servers/:server_id/members/:user_id/roles`
- Legacy compatibility: `PATCH /api/servers/:server_id/members/:user_id/role`

### Moderation

- `DELETE /api/servers/:server_id/members/:user_id` (kick, requires `KICK_MEMBERS`)
- `POST /api/servers/:server_id/members/:user_id/ban` (requires `BAN_MEMBERS`)
- `GET /api/servers/:server_id/bans` (requires `BAN_MEMBERS`)
- `DELETE /api/servers/:server_id/bans/:user_id` (requires `BAN_MEMBERS`)
- `GET /api/servers/:server_id/audit-log` (requires `VIEW_AUDIT_LOG`)

## Channel & Category Endpoints

### Channels

- `POST /api/channels` (requires `MANAGE_CHANNELS`)
  - If `category` is empty/missing, backend uses `General`.
  - Name uniqueness is enforced by scope: `(server, category, channel_type, case-insensitive name)`.
- `PATCH /api/channels/:channel_id` (requires `MANAGE_CHANNELS` at channel scope)
- `DELETE /api/channels/:channel_id` (requires `MANAGE_CHANNELS` at channel scope)
- `PATCH /api/channels/reorder`
- `GET /api/channels/:channel_id/overrides`
- `PUT /api/channels/:channel_id/overrides/:role_id`
- `DELETE /api/channels/:channel_id/overrides/:role_id`

### Categories

- `GET /api/channels/server/:server_id/categories`
- `POST /api/channels/server/:server_id/categories`
- `PATCH /api/channels/server/:server_id/categories/:category`
- `DELETE /api/channels/server/:server_id/categories/:category`
  - Optional `move_to` query parameter; channels default-move to `General`.
  - Deletion is blocked if channels cannot be moved safely.
- `GET /api/channels/server/:server_id/categories/:category/overrides`
- `PUT /api/channels/server/:server_id/categories/:category/overrides/:role_id`
- `DELETE /api/channels/server/:server_id/categories/:category/overrides/:role_id`
- `PATCH /api/channels/server/:server_id/categories/reorder`

## Message Endpoints (Server Channels)

- `GET /api/messages/:channel_id?before=<uuid>&limit=<n>`
- `GET /api/messages/:channel_id/search?q=<term>&limit=<n>`
- `POST /api/messages/:channel_id` (requires `SEND_MESSAGES`)
- `PATCH /api/messages/item/:message_id` (author only)
- `DELETE /api/messages/item/:message_id` (author or `MANAGE_MESSAGES`)

### Pins

- `GET /api/messages/:channel_id/pins`
- `POST /api/messages/:channel_id/pins` (requires `MANAGE_PINS`)
- `DELETE /api/messages/:channel_id/pins/:message_id` (requires `MANAGE_PINS`)

### Reactions

- `POST /api/messages/item/:message_id/reactions`
- `DELETE /api/messages/item/:message_id/reactions?emoji=...`
- Reaction add/remove requires effective `SEND_MESSAGES`.

## Friends Endpoints

- `GET /api/friends`
- `DELETE /api/friends/:friend_id`
- `GET /api/friends/requests`
- `POST /api/friends/requests`
- `POST /api/friends/requests/:request_id/accept`
- `POST /api/friends/requests/:request_id/reject`

## Direct Message Endpoints

- `GET /api/dm/channels`
- `POST /api/dm/channels/:peer_id`
- `GET /api/dm/messages/:channel_id?before=<uuid>&limit=<n>`
- `GET /api/dm/messages/:channel_id/search?q=<term>&limit=<n>`
- `POST /api/dm/messages/:channel_id`
- `PATCH /api/dm/messages/item/:message_id`
- `DELETE /api/dm/messages/item/:message_id`
- `GET /api/dm/channels/:channel_id/read-state`
- `GET /api/dm/channels/:channel_id/pins`
- `POST /api/dm/channels/:channel_id/pins`
- `DELETE /api/dm/channels/:channel_id/pins/:message_id`
- `POST /api/dm/messages/item/:message_id/reactions`
- `DELETE /api/dm/messages/item/:message_id/reactions?emoji=...`

## WebRTC Endpoints

- `GET /api/webrtc/turn-credentials`
- `GET /api/webrtc/livekit-token?channel_id=<voice-channel-uuid>`
  - Requires effective voice access (`VIEW_SERVER` + `CONNECT_VOICE` on the target channel).

## Health

- `GET /health`
  - `200` when DB + Redis connected
  - `503` when any critical dependency is unhealthy

## Rate Limit Notes

Current key limits (Redis-backed):

- Register: per-email + per-IP protection
- Login: per-identifier + per-IP protection
- Login brute-force lock: temporary lockout per identifier and per IP after repeated failed attempts
- Profile update: 12/min per user
- Change password: 5/hour per user
- Friend request: 10/min per user
- DM channel create: 5/min per user
- Message send: `MESSAGE_RATE_LIMIT_MAX` / `MESSAGE_RATE_LIMIT_WINDOW_SECS`
- WS connect: 3/10s per user

## Error Shape

Errors are JSON:

```json
{ "error": "Human-readable message" }
```

Common statuses:

- `400` validation/invalid request
- `401` unauthorized
- `403` forbidden
- `404` not found
- `429` too many requests
- `500` internal error

---

Last verified against code on 2026-03-14.
