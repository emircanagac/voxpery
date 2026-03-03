# WebSocket Events

Real-time communication via WebSocket: presence, typing indicators, voice state, message notifications.

## Connection

- **Endpoint**: `ws://HOST/ws` or `wss://HOST/ws`
- **Auth**: JWT via Cookie (web) or `Sec-WebSocket-Protocol: voxpery.auth,<token>` (desktop)
- **Subprotocol**: `voxpery.auth` (desktop only)
- **Reconnect**: Auto-reconnect with exponential backoff (3s delay)

## Protocol

All messages are JSON:

```typescript
// Client → Server
{ "type": "Subscribe", "data": { "channel_ids": ["uuid1", "uuid2"] } }

// Server → Client
{ "type": "NewMessage", "data": { "channel_id": "uuid", "message": {...} } }
```

## Client → Server Messages

### Subscribe

Subscribe to events for specific channels (server or DM).

```json
{ "type": "Subscribe", "data": { "channel_ids": ["channel-uuid"] } }
```

- Authorization: User must be member of channel's server (or DM participant)
- Effect: Client receives `NewMessage`, `Typing`, etc. for subscribed channels

### Unsubscribe

Stop receiving events for channels.

```json
{ "type": "Unsubscribe", "data": { "channel_ids": ["channel-uuid"] } }
```

### Typing

Broadcast typing indicator to channel.

```json
{ "type": "Typing", "data": { "channel_id": "uuid", "is_typing": true } }
```

- Rate limit: Max 3 per 10s per channel
- Authorization: Must be subscribed to channel

### JoinVoice

Join a voice channel (notifies other users).

```json
{ "type": "JoinVoice", "data": { "channel_id": "voice-channel-uuid" } }
```

- Authorization: Must be member of channel's server
- Effect: Backend stores in `voice_sessions`, broadcasts `VoiceStateUpdate`
- LiveKit connection: Client separately requests LiveKit token via REST API

### LeaveVoice

Leave current voice channel.

```json
{ "type": "LeaveVoice", "data": null }
```

- Effect: Clears `voice_sessions` entry, broadcasts `VoiceStateUpdate` with `channel_id: null`

### SetVoiceControl

Update voice controls (mute, deafen, screen sharing).

```json
{ "type": "SetVoiceControl", "data": { "muted": true, "deafened": false, "screen_sharing": false } }
```

- Effect: Broadcasts `VoiceControlUpdate` to all users

### Signal (Legacy WebRTC)

**Unused in current implementation** (LiveKit handles signaling internally).

### Ping

Measure WebSocket round-trip time.

```json
{ "type": "Ping", "data": { "sent_at_ms": 1234567890 } }
```

- Response: Server replies with `Pong` containing same `sent_at_ms`

## Server → Client Events

### NewMessage

A message was sent in a subscribed channel.

```json
{
  "type": "NewMessage",
  "data": {
    "channel_id": "uuid",
    "channel_type": "text",
    "message": {
      "id": "uuid",
      "content": "Hello",
      "author_id": "uuid",
      "author_username": "alice",
      "created_at": "2026-03-03T12:00:00Z",
      ...
    }
  }
}
```

### MessageDeleted

A message was deleted.

```json
{ "type": "MessageDeleted", "data": { "channel_id": "uuid", "message_id": "uuid" } }
```

### MessageUpdated

A message was edited.

```json
{ "type": "MessageUpdated", "data": { "channel_id": "uuid", "message": {...} } }
```

### Typing

User started/stopped typing.

```json
{ "type": "Typing", "data": { "channel_id": "uuid", "user_id": "uuid", "username": "alice", "is_typing": true } }
```

### PresenceUpdate

User status changed (online, idle, dnd, offline).

```json
{ "type": "PresenceUpdate", "data": { "user_id": "uuid", "status": "online" } }
```

- Broadcast to all connected users (global event)
- Status persists in DB; restored on reconnect

### VoiceStateUpdate

User joined/left a voice channel.

```json
{ "type": "VoiceStateUpdate", "data": { "channel_id": "voice-uuid", "user_id": "uuid", "server_id": "server-uuid" } }
```

- `channel_id: null` → user left voice
- Broadcast to all users (so members list updates everywhere)

### VoiceControlUpdate

User toggled mute, deafen, or screen sharing.

```json
{ "type": "VoiceControlUpdate", "data": { "user_id": "uuid", "muted": true, "deafened": false, "screen_sharing": false } }
```

### FriendUpdate

Friend request/status changed.

```json
{ "type": "FriendUpdate", "data": { "user_id": "uuid" } }
```

- Tells client to refetch friend list (`GET /api/friends`)

### MemberJoined / MemberLeft

User joined/left a server.

```json
{ "type": "MemberJoined", "data": { "server_id": "uuid", "user_id": "uuid", "username": "alice" } }
```

### MemberRoleUpdated

User role changed in a server.

```json
{ "type": "MemberRoleUpdated", "data": { "server_id": "uuid", "user_id": "uuid", "role": "moderator" } }
```

### UserUpdated

User profile changed (avatar, username).

```json
{ "type": "UserUpdated", "data": { "user": { "id": "uuid", "username": "alice", "avatar_url": "...", ... } } }
```

### Pong

Response to client `Ping`.

```json
{ "type": "Pong", "data": { "sent_at_ms": 1234567890 } }
```

## Presence System

- **On connect**: Backend broadcasts current user status (from DB)
- **On disconnect**: Backend sets status to `offline` (DB + broadcast)
- **Manual status change**: `PATCH /api/auth/status` → backend broadcasts `PresenceUpdate`
- **Multi-tab**: Status only set to `offline` when last tab closes

## Voice State Sync

### Join Flow

1. Client: `JoinVoice` via WS
2. Backend: Stores in `voice_sessions`, broadcasts `VoiceStateUpdate` + `VoiceControlUpdate`
3. Backend: Sends existing participants to joining client (direct via `tx`)
4. Client: Requests LiveKit token via REST (`GET /api/webrtc/livekit-token`)
5. Client: Connects to LiveKit Room

### Reconnect Flow (WS drops)

1. WS disconnects → backend clears `voice_sessions` (cleanup on disconnect)
2. WS reconnects → frontend detects reconnect
3. Frontend: LiveKit Room still connected? Re-send `JoinVoice` + `SetVoiceControl` via WS
4. Backend: Restores voice state, broadcasts to others

## Rate Limits

- **Connection**: Max 3 attempts per 10s per user
- **Typing**: Max 10 per minute per user (enforced client-side)
- **Subscribe**: No limit (authorization check per channel)

## Message Size Limit

- **Max incoming WS message**: 256 KB (prevents DoS via huge Signal payloads)

## Security

- **Authorization**: Every `Subscribe` checks `can_subscribe_to_channel` (DB query)
- **Voice access**: `JoinVoice` checks `can_join_voice_channel` (must be server member)
- **Signal spam**: Only allowed between users in same voice channel
- **Origin check**: Cookie auth requires valid CORS origin (no cross-origin hijack)

## Debugging

**Client-side**:
```typescript
useSocketStore.subscribe((event) => console.log('[WS]', event))
```

**Backend logs**:
```
tracing::info!("WebSocket connected: {} ({})", username, user_id);
tracing::warn!("Broadcast receiver lagged by {} events", n);
```

**Network inspector**: Chrome DevTools → Network → WS → Frames
