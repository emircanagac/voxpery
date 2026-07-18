# API Reference

REST API for auth, servers, channels/categories, messages/reactions, friends, DMs, and voice token minting.

## Base URL

- Development: `http://127.0.0.1:3001`
- Production: your API domain (for example `https://api.example.com`)

## Authentication

- Web: httpOnly cookie (`voxpery_token` by default)
- Desktop: `Authorization: Bearer <jwt>`

Cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests must come from an
origin listed in `CORS_ORIGINS`. The API verifies `Origin` (or same-origin `Referer`
when `Origin` is absent); cross-site cookie mutations return `403`. Bearer-authenticated
desktop requests are not subject to browser CSRF checks.

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
  - `dm_privacy` values: `everyone`, `friends`; new accounts default to `everyone`
- `GET /api/auth/check-username?username=...`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/email/request-verification` (auth required)
- `POST /api/auth/email/confirm`
- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `GET /api/auth/data-export`
  - GDPR/KVKK data export JSON payload for authenticated user.
  - Export format: `voxpery-user-data-v2`.
  - Export is intentionally user-readable and data-minimized: internal database IDs, tokens, sessions, password hashes, raw avatar URLs, signed attachment URLs, and storage identifiers are omitted.
  - Payload sections include export metadata, account, profile summary, servers, relationships, and authored messages.
- `DELETE /api/auth/account`
  - Body: `{ "confirm": "DELETE", "password"?: "..." }`
  - Permanently deletes account and authored content.

Notes:

- `forgot-password` always returns a generic success message to prevent account enumeration.
- For unknown email (or Google-only account), no reset email is sent.
- `email/request-verification` can optionally change the current account email and issues a fresh verification token.
- `email/confirm` accepts the verification token from the email link and can be redeemed without an existing session.

## Server Endpoints

- `GET /api/servers`
- `POST /api/servers`
  - Optional `client_request_id` (1-128 URL-safe characters) makes retries return the originally created server. Reusing the ID with different server data returns `409`.
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

### Onboarding

- `GET /api/servers/:server_id/onboarding` (requires `VIEW_SERVER`)
  - Returns the server welcome guide, including enabled state, intro copy, starter tasks, and recommended channel IDs.
- `PATCH /api/servers/:server_id/onboarding` (requires `MANAGE_SERVER`)
  - Body: `{ "enabled": true, "title": "Welcome", "body": "Start here", "recommended_channel_ids": ["uuid"], "starter_tasks": ["Read the rules"] }`
  - Limits: title 80 chars, body 1000 chars, up to 6 recommended channels, up to 6 starter tasks of 120 chars each.
  - Recommended channels must belong to the same server.

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
- `POST /api/servers/:server_id/members/:user_id/timeout` (requires `MANAGE_MESSAGES`)
  - Body: `{ "duration_minutes": 60, "reason": "optional note" }`
  - Duration must be 1 minute to 7 days. Active timeouts block server-channel sends, edits, and new reactions.
- `DELETE /api/servers/:server_id/members/:user_id/timeout` (requires `MANAGE_MESSAGES`)
- `GET /api/servers/:server_id/timeouts` (requires `VIEW_AUDIT_LOG`, `BAN_MEMBERS`, or `MANAGE_MESSAGES`)
- `GET /api/servers/:server_id/raid-events` (requires `VIEW_AUDIT_LOG`, `BAN_MEMBERS`, or `MANAGE_MESSAGES`)
- `GET /api/servers/:server_id/bans` (requires `BAN_MEMBERS`)
- `DELETE /api/servers/:server_id/bans/:user_id` (requires `BAN_MEMBERS`)
- `GET /api/servers/:server_id/audit-log` (requires `VIEW_AUDIT_LOG`)
- `GET /api/servers/:server_id/automod-rules` (requires `MANAGE_MESSAGES`)
- `POST /api/servers/:server_id/automod-rules` (requires `MANAGE_MESSAGES`)
- `PATCH /api/servers/:server_id/automod-rules/:rule_id` (requires `MANAGE_MESSAGES`)
- `DELETE /api/servers/:server_id/automod-rules/:rule_id` (requires `MANAGE_MESSAGES`)
  - `trigger_type` values: `blocked_keyword`, `invite_filter`, `link_filter`, `mention_spam`.
  - Rules support `exempt_role_ids` and `exempt_channel_ids`.
  - Enabled rules block matching server-channel sends/edits before persistence or broadcast.

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

## Attachment Upload Endpoint

- `POST /api/attachments/upload` (auth required)
  - `multipart/form-data` with one or more `files` fields.
  - Default per-file limit is 10 MB (`ATTACHMENTS_MAX_FILE_BYTES=10485760`).
  - The client MIME value must be allowlisted, but it is not trusted as proof of content. The server checks magic bytes, rejects MIME mismatches, active markup, executable formats, and unidentified binary data, then stores the canonical detected MIME.
  - Generic `application/octet-stream` declarations remain compatible with files whose actual type is safely detected, including ZIP uploads from browsers that do not report a specific ZIP MIME.
  - Returns uploaded attachment objects with `id`, signed `url`, `type`, `name`, `size`, `sha256`.
  - Upload pipeline: size/allowlist validation -> magic-byte content validation -> bounded JPEG/PNG decode and metadata cleanup -> optional ClamAV scan -> atomic local storage write -> quota and metadata transaction -> short-lived signed URL.
  - Multi-file uploads are all-or-nothing. If validation, quota reservation, metadata persistence, or transaction commit fails, database changes are rolled back and files already written for that request are removed.
  - Retry-equivalent files from the same user reuse the existing clean attachment record and do not consume storage quota twice.
- `GET /api/attachments/content/:attachment_id?exp=...&sig=...`
  - Auth-required endpoint guarded by signature + expiry + attachment ACL checks.
  - Streams attachment media in chat without exposing permanent public file URLs.

## Image Proxy Endpoint

- `GET /api/images/avatar?url=<encoded-https-url>`
  - Proxies third-party avatar images so viewers do not request user-supplied image hosts directly.
  - Accepts only public `https://` URLs, rejects redirects, local/private host resolution, unsupported content types, and images over 3 MB.
  - Returns `image/jpeg`, `image/png`, `image/gif`, or `image/webp` with cache headers and `X-Content-Type-Options: nosniff`.
- `GET /api/images/remote?url=<encoded-https-url>`
  - Uses the same SSRF, MIME, size, redirect, cache, and rate-limit controls for remote server icons and inline GIF/sticker previews.
  - Intended for user-controlled remote media that should render without exposing viewer IP/user-agent to the original host.

## Message Endpoints (Server Channels)

- `GET /api/messages/:channel_id?before=<uuid>&limit=<n>`
- `GET /api/messages/:channel_id/search?q=<term>&from=<username>&has_attachment=<bool>&limit=<n>`
  - `from` filters by message author username.
  - `has_attachment=true` returns only messages with one or more attachments.
- `POST /api/messages/:channel_id` (requires `SEND_MESSAGES`)
  - Optional `client_request_id` makes network retries return the original message without a second database row or WebSocket broadcast. Reusing the ID with different content returns `409`.
- `PATCH /api/messages/item/:message_id` (author only)
- `DELETE /api/messages/item/:message_id` (author or `MANAGE_MESSAGES`)
- Enabled AutoMod rules are evaluated before server-channel sends/edits are stored or broadcast. Keyword, link, invite, and mention-spam checks normalize invisible Unicode format/control characters before matching.
- Active member timeouts block server-channel sends/edits and new reactions before persistence or broadcast.
- Server-level raid protection records join bursts, new-account join bursts, message bursts, and invite spikes in moderation activity/audit logs; message and invite bursts can return `429`.
- User and message reports are rate limited per reporter/server, deduplicated while an open report for the same target exists, and moderation report listing returns the most recent 200 entries.

### Pins

- `GET /api/messages/:channel_id/pins`
- `POST /api/messages/:channel_id/pins` (requires `MANAGE_PINS`)
- `DELETE /api/messages/:channel_id/pins/:message_id` (requires `MANAGE_PINS`)
- Server channels and direct-message conversations accept at most 50 pinned messages. Concurrent pin requests are serialized against the parent channel.

### Reactions

- `POST /api/messages/item/:message_id/reactions`
- `DELETE /api/messages/item/:message_id/reactions?emoji=...`
- Reaction add/remove requires effective `SEND_MESSAGES`.
- Server and direct messages accept at most 20 distinct reaction emoji. Concurrent additions are serialized against the parent message.

## Friends Endpoints

- `GET /api/friends`
- `DELETE /api/friends/:friend_id`
- `GET /api/friends/requests`
- `POST /api/friends/requests`
  - Concurrent requests for the same unordered user pair create at most one pending request.
- `POST /api/friends/requests/:request_id/accept`
- `POST /api/friends/requests/:request_id/reject`

## Direct Message Endpoints

- `GET /api/dm/channels`
  - Returns visible DM channel metadata including `unread_count`, the server-derived unread count for the current user.
  - Channels hidden by the current user are excluded unless they have unread messages.
- `POST /api/dm/channels/:peer_id`
  - Opens or creates a DM channel with the peer and restores it if the current user had hidden it.
- `POST /api/dm/channels/:channel_id/hide`
  - Hides the channel from the current user's DM list without deleting messages or hiding it for the peer.
- `GET /api/dm/messages/:channel_id?before=<uuid>&limit=<n>`
- `GET /api/dm/messages/:channel_id/search?q=<term>&from=<username>&has_attachment=<bool>&limit=<n>`
  - `from` filters by message author username.
  - `has_attachment=true` returns only messages with one or more attachments.
- `POST /api/dm/messages/:channel_id`
  - Supports the same optional `client_request_id` retry contract as server-channel messages.
- `PATCH /api/dm/messages/item/:message_id`
- `DELETE /api/dm/messages/item/:message_id`
- `GET /api/dm/channels/:channel_id/read-state`
- `POST /api/dm/channels/:channel_id/read`
  - Marks the current user's DM read state through the latest message in the channel and emits a `DmRead` WebSocket event for the user's other sessions.
- `GET /api/dm/channels/:channel_id/pins`
- `POST /api/dm/channels/:channel_id/pins`
- `DELETE /api/dm/channels/:channel_id/pins/:message_id`
- `POST /api/dm/messages/item/:message_id/reactions`
- `DELETE /api/dm/messages/item/:message_id/reactions?emoji=...`

Attachment note:
- Message/DM `attachments[].url` only accepts `http://` or `https://`.
- `data:` URLs are blocked intentionally; upload via `/api/attachments/upload`.
- Backend canonicalizes attachment references to uploaded IDs and returns fresh signed URLs in message payloads.

## WebRTC Endpoints

- `GET /api/webrtc/turn-credentials`
- `GET /api/webrtc/livekit-token?channel_id=<voice-channel-uuid>`
  - Requires effective voice access (`VIEW_SERVER` + `CONNECT_VOICE` on the target channel).
  - Returns `503` with `FEATURE_DISABLED` when the voice media service is not configured.

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
- Friend request: 5/min per user
- DM channel create: 5/min per user
- Server and DM message search: 15/min per user/channel
- Message send: `MESSAGE_RATE_LIMIT_MAX` / `MESSAGE_RATE_LIMIT_WINDOW_SECS`
- TURN credentials: 30/min per user
- LiveKit tokens: 30/min per user and 20/min per user/voice channel
- Attachment content: 240/min per user and 30/min per user/attachment
- Report submit: 5/min per reporter/server
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

Last verified against code on 2026-04-15.
