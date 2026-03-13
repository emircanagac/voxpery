# API Reference

REST API for authentication, servers, channels, messages, friends, direct messages, and voice tokening.

## Base URL

- Development: `http://127.0.0.1:3001`
- Production: `https://api.your-domain.com`

## Authentication

Authenticated endpoints accept:

- Web: httpOnly cookie (`voxpery_token`, configurable)
- Desktop: `Authorization: Bearer <jwt>`

## Authorization Model

Server authorization is bitmask-permission based (aggregated from assigned roles), not a single moderator/admin flag.

- Roles: `/api/servers/:server_id/roles*`
- Member role assignments: `/api/servers/:server_id/members/:user_id/roles`
- `Everyone` role is seeded by default per server.

## Auth

### POST `/api/auth/register`

Create account.

Request:
```json
{ "username": "alice", "email": "alice@example.com", "password": "secure123", "captcha_token": "optional" }
```

Response (200):
```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "username": "alice",
    "avatar_url": null,
    "status": "online",
    "dm_privacy": "everyone",
    "username_changed_at": null
  }
}
```

### POST `/api/auth/login`

Request:
```json
{ "identifier": "alice", "password": "secure123" }
```

Response (200): same shape as register.

### POST `/api/auth/logout`

Clears cookie and blacklists current token when available.

Response (200):
```json
{}
```

### GET `/api/auth/me`

Response (200): `UserPublic`
```json
{
  "id": "uuid",
  "username": "alice",
  "avatar_url": null,
  "status": "online",
  "dm_privacy": "everyone",
  "username_changed_at": null
}
```

### PATCH `/api/auth/status`

Request:
```json
{ "status": "dnd" }
```

Values: `online`, `idle`, `dnd`, `offline`

Response (200): updated `UserPublic`.

### PATCH `/api/auth/profile`

Update username/avatar/privacy.

Request (example):
```json
{
  "username": "alice_new",
  "avatar_url": "https://cdn.example.com/avatar.png",
  "clear_avatar": false,
  "dm_privacy": "friends"
}
```

`dm_privacy` values: `everyone`, `friends`

Response (200): updated `UserPublic`.

### GET `/api/auth/check-username?username=...`

Response (200):
```json
{ "available": true }
```

### POST `/api/auth/change-password`

Request:
```json
{ "old_password": "old", "new_password": "newpassword123" }
```

Response (200):
```json
{ "message": "Password changed successfully" }
```

### POST `/api/auth/forgot-password`

Request:
```json
{ "email": "alice@example.com" }
```

Response (200):
```json
{ "message": "If an account with that email exists, we have sent a password reset link." }
```

### POST `/api/auth/reset-password`

Request:
```json
{ "token": "reset-token", "new_password": "newpassword123" }
```

Response (200):
```json
{ "message": "Password has been successfully reset. You can now log in." }
```

### GET `/api/auth/google`
### GET `/api/auth/google/callback`

Google OAuth redirect/callback endpoints (when configured).

## Servers

### GET `/api/servers`

Response (200):
```json
[
  {
    "id": "uuid",
    "name": "My Server",
    "icon_url": null,
    "owner_id": "uuid",
    "invite_code": "abc123",
    "created_at": "2026-03-13T00:00:00Z",
    "member_count": 4
  }
]
```

### POST `/api/servers`

Request:
```json
{ "name": "My Server", "icon_url": null }
```

Response (200): `Server`

### GET `/api/servers/:server_id`

Response (200):
```json
{
  "id": "uuid",
  "name": "My Server",
  "icon_url": null,
  "owner_id": "uuid",
  "invite_code": "abc123",
  "created_at": "2026-03-13T00:00:00Z",
  "my_permissions": 1153,
  "members": [
    {
      "user_id": "uuid",
      "username": "alice",
      "avatar_url": null,
      "role": "owner",
      "status": "online",
      "role_color": "#5865F2"
    }
  ]
}
```

### PATCH `/api/servers/:server_id`

Requires `MANAGE_SERVER`.

Request:
```json
{ "name": "Renamed", "icon_url": "https://...", "clear_icon": false }
```

Response (200): updated `Server`.

### DELETE `/api/servers/:server_id`

Owner only.

Response (200):
```json
{ "message": "Server deleted" }
```

### POST `/api/servers/join`

Request:
```json
{ "invite_code": "abc123" }
```

Response (200): `Server`

### POST `/api/servers/:server_id/leave`

Response (200):
```json
{ "message": "Left server" }
```

### GET `/api/servers/:server_id/channels`

Response (200): `Channel[]`

### GET `/api/servers/:server_id/roles`
### POST `/api/servers/:server_id/roles`
### PATCH `/api/servers/:server_id/roles/:role_id`
### DELETE `/api/servers/:server_id/roles/:role_id`
### PATCH `/api/servers/:server_id/roles/reorder`

Role management endpoints (requires `MANAGE_ROLES`; owner-only constraints apply for some operations).

Create request example:
```json
{ "name": "Moderator", "color": "#5865F2", "permissions": 6992 }
```

Reorder request example:
```json
{ "role_ids": ["uuid-role-1", "uuid-role-2"] }
```

### GET `/api/servers/:server_id/members/:user_id/roles`

Response (200):
```json
["uuid-role-1", "uuid-role-2"]
```

### PUT `/api/servers/:server_id/members/:user_id/roles`

Request:
```json
{ "role_ids": ["uuid-role-1", "uuid-role-2"] }
```

Response (200):
```json
{ "message": "Member roles updated" }
```

Legacy compat endpoint:
- `PATCH /api/servers/:server_id/members/:user_id/role`

### DELETE `/api/servers/:server_id/members/:user_id`

Requires `KICK_MEMBERS`.

Response (200):
```json
{ "message": "Member kicked" }
```

### GET `/api/servers/:server_id/audit-log`

Requires `VIEW_AUDIT_LOG`.

Response (200): audit entries
```json
[
  {
    "id": "uuid",
    "at": "2026-03-13T00:00:00Z",
    "actor_id": "uuid",
    "server_id": "uuid",
    "action": "member_role_change",
    "resource_type": "user",
    "resource_id": "uuid",
    "details": {},
    "actor_username": "admin",
    "resource_username": "member"
  }
]
```

## Channels

### POST `/api/channels`

Requires `MANAGE_CHANNELS`.

Request:
```json
{ "server_id": "uuid", "name": "general", "channel_type": "text", "category": "Text Channels" }
```

Response (200): `Channel`

### PATCH `/api/channels/:channel_id`

Requires `MANAGE_CHANNELS`.

Request:
```json
{ "name": "new-name" }
```

Response (200): updated `Channel`

### DELETE `/api/channels/:channel_id`

Requires `MANAGE_CHANNELS`.

Response (200):
```json
{ "message": "Channel deleted" }
```

### PATCH `/api/channels/reorder`

Request:
```json
{ "server_id": "uuid", "channel_ids": ["uuid1", "uuid2"] }
```

Response (200):
```json
{ "message": "Channels reordered" }
```

### GET `/api/channels/:channel_id/overrides`
### PUT `/api/channels/:channel_id/overrides/:role_id`
### DELETE `/api/channels/:channel_id/overrides/:role_id`

Channel role override management (`allow`/`deny` bitmasks), requires `MANAGE_CHANNELS`.

## Messages (Server Channels)

### GET `/api/messages/:channel_id?before=<uuid>&limit=<n>`

Response (200): `MessageWithAuthor[]`
```json
[
  {
    "id": "uuid",
    "channel_id": "uuid",
    "content": "Hello",
    "attachments": null,
    "edited_at": null,
    "created_at": "2026-03-13T00:00:00Z",
    "author": {
      "user_id": "uuid",
      "username": "alice",
      "avatar_url": null,
      "role_color": "#5865F2"
    }
  }
]
```

### GET `/api/messages/:channel_id/search?q=<term>&limit=<n>`

Response (200): `MessageWithAuthor[]`

### POST `/api/messages/:channel_id`

Request:
```json
{ "content": "Hello world", "attachments": null }
```

Response (200): `MessageWithAuthor`

### PATCH `/api/messages/item/:message_id`

Request:
```json
{ "content": "Edited content" }
```

Response (200): `MessageWithAuthor`

### DELETE `/api/messages/item/:message_id`

Response (200):
```json
{ "message": "Deleted", "id": "uuid" }
```

### GET `/api/messages/:channel_id/pins`

Response (200): `MessageWithAuthor[]`

### POST `/api/messages/:channel_id/pins`

Request:
```json
{ "message_id": "uuid" }
```

Response (200): pinned `MessageWithAuthor`

### DELETE `/api/messages/:channel_id/pins/:message_id`

Response (200):
```json
{ "ok": true }
```

## Friends

### GET `/api/friends`

Response (200): `FriendUser[]`

### GET `/api/friends/requests`

Response (200):
```json
{
  "incoming": [],
  "outgoing": []
}
```

### POST `/api/friends/requests`

Request:
```json
{ "username": "bob" }
```

Response (200):
```json
{ "message": "Friend request sent" }
```

### POST `/api/friends/requests/:request_id/accept`
### POST `/api/friends/requests/:request_id/reject`
### DELETE `/api/friends/:friend_id`

Responses (200):
```json
{ "message": "Friend request accepted" }
```
```json
{ "message": "Friend request rejected" }
```
```json
{ "message": "Friend removed" }
```

## Direct Messages

### GET `/api/dm/channels`

Response (200): `DmChannelInfo[]`

### POST `/api/dm/channels/:peer_id`

Get or create channel with peer.

Response (200): `DmChannelInfo`

### GET `/api/dm/messages/:channel_id?before=<uuid>&limit=<n>`

Response (200): `MessageWithAuthor[]`

### GET `/api/dm/messages/:channel_id/search?q=<term>&limit=<n>`

Response (200): `MessageWithAuthor[]`

### POST `/api/dm/messages/:channel_id`

Request:
```json
{ "content": "Hi", "attachments": null }
```

Response (200): `MessageWithAuthor`

### PATCH `/api/dm/messages/item/:message_id`

Request:
```json
{ "content": "Edited DM" }
```

Response (200): `MessageWithAuthor`

### DELETE `/api/dm/messages/item/:message_id`

Response (200):
```json
{ "message": "DM message deleted", "id": "uuid" }
```

### GET `/api/dm/channels/:channel_id/read-state`

Response (200):
```json
{ "peer_last_read_message_id": "uuid-or-null" }
```

### GET `/api/dm/channels/:channel_id/pins`
### POST `/api/dm/channels/:channel_id/pins`
### DELETE `/api/dm/channels/:channel_id/pins/:message_id`

Pin/unpin DM messages.

Unpin response (200):
```json
{ "ok": true }
```

## WebRTC

### GET `/api/webrtc/turn-credentials`

Response (200):
```json
{
  "urls": ["turn:turn.example.com:3478"],
  "username": "1700000000:user-uuid",
  "credential": "base64signature"
}
```

If TURN is not configured:
```json
{ "urls": [] }
```

### GET `/api/webrtc/livekit-token?channel_id=<voice-channel-uuid>`

Response (200):
```json
{
  "ws_url": "wss://livekit.example.com",
  "token": "jwt",
  "room": "channel-uuid",
  "identity": "user-uuid"
}
```

## Health

### GET `/health`

Healthy response (200):
```json
{ "status": "ok", "database": "connected" }
```

Unhealthy response (503):
```json
{ "status": "unhealthy", "database": "disconnected" }
```

## Rate Limits (Current)

- Register: per-email + per-IP protection
- Login: per-identifier
- Profile update: 12/min per user
- Change password: 5/hour per user
- Friend request: 10/min per user
- DM channel create: 5/min per user
- Message send: configured per user (`MESSAGE_RATE_LIMIT_MAX` / `MESSAGE_RATE_LIMIT_WINDOW_SECS`)
- WS connect: 3/10s per user

## Error Responses

Errors are JSON:
```json
{ "error": "Human-readable message" }
```

Common statuses:
- `400` invalid request/validation
- `401` unauthorized
- `403` forbidden
- `404` not found
- `429` too many requests
- `500` internal error
