# API Reference

REST API for authentication, servers, channels, messages, friends, and direct messages.

## Base URL

- **Development**: `http://127.0.0.1:3001`
- **Production**: `https://api.your-domain.com`

## Authentication

All authenticated endpoints require either:

- **Web**: httpOnly cookie (`voxpery_token`) — set automatically on login
- **Desktop**: `Authorization: Bearer <jwt>` header

### POST `/api/auth/register`

Create a new account.

**Request**:
```json
{ "username": "alice", "email": "alice@example.com", "password": "secure123" }
```

**Response** (200):
```json
{
  "token": "eyJhbGc...",
  "user": { "id": "uuid", "username": "alice", "email": "alice@example.com", "status": "online", ... }
}
```

**Errors**:
- `400`: Username/email taken, validation failed
- `429`: Rate limit exceeded (10 attempts per minute)

### POST `/api/auth/login`

Login with username/email + password.

**Request**:
```json
{ "identifier": "alice", "password": "secure123" }
```

**Response** (200): Same as register

**Errors**:
- `401`: Invalid credentials
- `429`: Rate limit exceeded

### GET `/api/auth/me`

Get current user info.

**Response** (200):
```json
{ "id": "uuid", "username": "alice", "email": "alice@example.com", "status": "online", ... }
```

### PATCH `/api/auth/status`

Update presence status.

**Request**:
```json
{ "status": "dnd" }
```

**Values**: `online`, `idle`, `dnd`, `offline`

**Response** (200): Updated user object

### PATCH `/api/auth/profile`

Update avatar or DM privacy.

**Request**:
```json
{ "avatar_url": "https://cdn.example.com/avatar.png", "dm_privacy": "friends" }
```

**DM privacy values**: `everyone`, `friends`, `server_members`

**Response** (200): Updated user object

### POST `/api/auth/logout`

Logout (clears cookie, blacklists JWT).

**Response** (200): `{ "message": "Logged out" }`

### POST `/api/auth/change-password`

Change password (requires re-login).

**Request**:
```json
{ "old_password": "secure123", "new_password": "newsecure456" }
```

**Response** (200): Cookie cleared, client must re-login

## Servers

### GET `/api/servers`

List user's servers.

**Response** (200):
```json
[
  { "id": "uuid", "name": "My Server", "owner_id": "uuid", "icon_url": null, "invite_code": "abc123", ... }
]
```

### GET `/api/servers/:id`

Get server details + members.

**Response** (200):
```json
{
  "id": "uuid",
  "name": "My Server",
  "members": [
    { "user_id": "uuid", "username": "alice", "avatar_url": null, "role": "owner", "status": "online" }
  ],
  ...
}
```

### POST `/api/servers`

Create a new server.

**Request**:
```json
{ "name": "My Server" }
```

**Response** (201): Server object

### PATCH `/api/servers/:id`

Update server name or icon.

**Request**:
```json
{ "name": "Renamed Server", "icon_url": "https://..." }
```

**Authorization**: Owner or moderator

**Response** (200): Updated server object

### POST `/api/servers/join`

Join server via invite code.

**Request**:
```json
{ "invite_code": "abc123" }
```

**Response** (200): Server object

**Errors**:
- `404`: Invalid invite code
- `400`: Already a member

### POST `/api/servers/:id/leave`

Leave a server.

**Response** (200): `{ "message": "Left server" }`

**Note**: Owner cannot leave (must delete server or transfer ownership)

### DELETE `/api/servers/:id`

Delete a server (owner only).

**Response** (200): `{ "message": "Server deleted" }`

### GET `/api/servers/:id/channels`

List channels in a server.

**Response** (200):
```json
[
  { "id": "uuid", "name": "general", "channel_type": "text", "position": 0, ... }
]
```

### PATCH `/api/servers/:server_id/members/:user_id/role`

Change member role (owner/moderator only).

**Request**:
```json
{ "role": "moderator" }
```

**Values**: `moderator`, `member`

**Response** (200): `{ "message": "Role updated" }`

### DELETE `/api/servers/:server_id/members/:user_id`

Kick member (owner/moderator only).

**Response** (200): `{ "message": "Member kicked" }`

## Channels

### POST `/api/channels`

Create a channel.

**Request**:
```json
{ "server_id": "uuid", "name": "general", "channel_type": "text" }
```

**Channel types**: `text`, `voice`

**Authorization**: Server member

**Response** (201): Channel object

### DELETE `/api/channels/:id`

Delete a channel (owner/moderator only).

**Response** (200): `{ "message": "Channel deleted" }`

### PATCH `/api/channels/:id`

Rename a channel.

**Request**:
```json
{ "name": "new-name" }
```

**Response** (200): Updated channel object

### PATCH `/api/channels/reorder`

Reorder channels.

**Request**:
```json
{ "server_id": "uuid", "channel_ids": ["uuid1", "uuid2", "uuid3"] }
```

**Response** (200): `{ "message": "Channels reordered" }`

## Messages

### GET `/api/messages/:channel_id`

Load messages (paginated).

**Query params**:
- `limit` (default: 50, max: 100)
- `before` (message UUID, for pagination)

**Response** (200):
```json
[
  { "id": "uuid", "content": "Hello", "author_id": "uuid", "author_username": "alice", "created_at": "...", ... }
]
```

**Order**: Newest first (reverse chronological)

### POST `/api/messages/:channel_id`

Send a message.

**Request**:
```json
{ "content": "Hello world!", "attachments": null }
```

**Rate limit**: 30 messages per 10 seconds

**Response** (201): Message object (also broadcast via WebSocket)

### PATCH `/api/messages/item/:message_id`

Edit a message (author only).

**Request**:
```json
{ "content": "Edited content" }
```

**Response** (200): Updated message object

### DELETE `/api/messages/item/:message_id`

Delete a message (author/owner/moderator).

**Response** (200): `{ "message": "Message deleted", "id": "uuid" }`

## Friends

### GET `/api/friends`

List friends.

**Response** (200):
```json
[
  { "id": "uuid", "username": "bob", "avatar_url": null, "status": "online" }
]
```

### GET `/api/friends/requests`

List friend requests (incoming + outgoing).

**Response** (200):
```json
{
  "incoming": [
    { "id": "uuid", "requester_id": "uuid", "requester_username": "bob", ... }
  ],
  "outgoing": [...]
}
```

### POST `/api/friends/requests`

Send friend request.

**Request**:
```json
{ "username": "bob" }
```

**Response** (201): `{ "message": "Friend request sent" }`

**Errors**:
- `404`: User not found
- `400`: Already friends or request pending

### POST `/api/friends/requests/:id/accept`

Accept friend request.

**Response** (200): `{ "message": "Friend request accepted" }`

### POST `/api/friends/requests/:id/reject`

Reject friend request.

**Response** (200): `{ "message": "Friend request rejected" }`

### DELETE `/api/friends/:friend_id`

Remove friend.

**Response** (200): `{ "message": "Friend removed" }`

## Direct Messages

### GET `/api/dm/channels`

List DM channels.

**Response** (200):
```json
[
  {
    "id": "uuid",
    "peer_id": "uuid",
    "peer_username": "bob",
    "peer_avatar_url": null,
    "peer_status": "online",
    "last_message_at": "2026-03-03T12:00:00Z"
  }
]
```

### POST `/api/dm/channels/:peer_id`

Get or create DM channel with a user.

**Response** (200): DM channel object

**Authorization**: DM privacy check applies

### GET `/api/dm/messages/:channel_id`

Load DM messages (same as server messages).

**Query params**: `limit`, `before`

**Response** (200): Array of messages

### POST `/api/dm/messages/:channel_id`

Send DM.

**Request**:
```json
{ "content": "Hi!", "attachments": null }
```

**Response** (201): Message object

### PATCH `/api/dm/messages/item/:message_id`

Edit DM (author only).

**Response** (200): Updated message

### DELETE `/api/dm/messages/item/:message_id`

Delete DM (author only).

**Response** (200): `{ "message": "Message deleted" }`

### GET `/api/dm/channels/:channel_id/read-state`

Get peer's last-read message.

**Response** (200):
```json
{ "peer_last_read_message_id": "uuid" }
```

## WebRTC

### GET `/api/webrtc/turn-credentials`

Get TURN server credentials for NAT traversal.

**Response** (200):
```json
{
  "urls": ["turn:turn.example.com:3478"],
  "username": "1234567890:uuid",
  "credential": "base64secret"
}
```

**TTL**: 1 hour (credentials expire)

### GET `/api/webrtc/livekit-token?channel_id=...`

Get LiveKit access token for voice channel.

**Query params**:
- `channel_id` (required, voice channel UUID)

**Response** (200):
```json
{
  "ws_url": "wss://livekit.example.com",
  "token": "eyJhbGc...",
  "room": "channel-uuid",
  "identity": "user-uuid"
}
```

**Authorization**: Must be member of channel's server

**TTL**: 1 hour

## Health

### GET `/health`

Liveness/readiness check.

**Response** (200):
```json
{ "status": "ok", "database": "connected" }
```

## Rate Limits

- **Auth endpoints**: 10 requests per minute per IP
- **Message send**: 30 messages per 10 seconds per user
- **General**: No explicit limit (rely on reverse proxy)

## Error Responses

All errors return JSON:

```json
{ "error": "Human-readable message" }
```

**Status codes**:
- `400`: Bad request, validation error
- `401`: Unauthorized (missing/invalid JWT)
- `403`: Forbidden (insufficient permissions)
- `404`: Not found
- `429`: Rate limit exceeded
- `500`: Internal server error
