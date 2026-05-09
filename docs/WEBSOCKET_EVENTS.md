# WebSocket Events

Real-time transport for presence, channel updates, typing, and voice state.

## Connection

- Endpoint: `ws://HOST/ws` or `wss://HOST/ws`
- Auth:
  - Web: auth cookie
  - Desktop: `Sec-WebSocket-Protocol: voxpery.auth,<token>`
- Origin check:
  - Cookie-auth websocket upgrades require allowed origin.
- Connection rate limit: `3 / 10s` per user (Redis-backed)
- Incoming WS frame rate limit: `120 / 10s` per user (Redis-backed)
- Max incoming text frame size: `256 KB`

## Multi-Instance Delivery

- Backend instances publish broadcast and targeted user events to Redis Pub/Sub channel `voxpery:ws-events:v1`.
- Every instance also keeps a local `tokio::broadcast` stream for sockets connected to that process.
- Published events carry an instance origin ID so the publishing process does not deliver the Redis echo twice.
- Targeted user events, such as DM and friend updates, are delivered to local sockets and also published so other instances can deliver them to sockets they own.
- REST list endpoints that calculate online/offline from active socket maps are still instance-local until presence state is externalized.
- Voice session/control state remains process-local today. Use sticky `/ws` routing when running multiple backend instances with voice enabled until that state is moved to Redis or another shared coordinator.

## Protocol Shape

All messages are JSON with `type` + `data`:

```json
{ "type": "Subscribe", "data": { "channel_ids": ["uuid"] } }
```

## Client -> Server Messages

### `Subscribe`

```json
{ "type": "Subscribe", "data": { "channel_ids": ["channel-uuid"] } }
```

Authorization:

- Server channels: requires effective `VIEW_SERVER` on that channel.
- DM channels: user must be a member of that DM channel.

### `Unsubscribe`

```json
{ "type": "Unsubscribe", "data": { "channel_ids": ["channel-uuid"] } }
```

### `Typing`

```json
{ "type": "Typing", "data": { "channel_id": "uuid", "is_typing": true } }
```

Authorization:

- User must be allowed to subscribe to the channel.

Note:

- There is no dedicated server-side typing throttle in WS handler today; clients should debounce.

### `JoinVoice`

```json
{ "type": "JoinVoice", "data": { "channel_id": "voice-channel-uuid" } }
```

Authorization:

- Channel must be `voice`
- Effective channel permissions must include both:
  - `VIEW_SERVER`
  - `CONNECT_VOICE`

### `LeaveVoice`

```json
{ "type": "LeaveVoice", "data": null }
```

### `SetVoiceControl`

```json
{
  "type": "SetVoiceControl",
  "data": {
    "target_user_id": "optional-uuid",
    "muted": false,
    "deafened": false,
    "screen_sharing": false,
    "camera_on": false
  }
}
```

Behavior:

- Without `target_user_id`, updates self voice controls.
- With `target_user_id`, server moderation controls apply (`MUTE_MEMBERS` / `DEAFEN_MEMBERS`) and only when both users are in the same voice channel.

### `Signal`

Legacy custom signaling event.

- Only forwarded when sender and target are in the same voice channel.
- LiveKit handles media signaling in normal voice flow.

### `Ping`

```json
{ "type": "Ping", "data": { "sent_at_ms": 1234567890 } }
```

## Server -> Client Events

### Channel/Message

- `NewMessage`
- `MessageUpdated`
- `MessageDeleted`
- `Typing`

### Presence/User

- `PresenceUpdate` (`online`, `dnd`, `offline`)
- `UserUpdated`

### Friends

- `FriendUpdate`

### Server Membership / Roles / Channels

- `MemberJoined`
- `MemberLeft`
- `MemberRoleUpdated`
- `ServerRolesUpdated`
- `ServerChannelsUpdated`

### Voice

- `VoiceStateUpdate`
  - `channel_id: null` means user left voice.
- `VoiceControlUpdate`
  - Includes combined and server-enforced flags:
    - `muted`
    - `deafened`
    - `server_muted`
    - `server_deafened`
    - `screen_sharing`
    - `camera_on`
    - `server_id`

### Low-level

- `Signal`
- `Pong`

## Voice + LiveKit Flow

1. Client sends `JoinVoice` over WS.
2. Backend validates effective permission and updates process-local `voice_sessions`.
3. Backend broadcasts voice state/control events.
4. Client requests `GET /api/webrtc/livekit-token`.
5. Client connects to LiveKit room.

## Security Notes

- `Subscribe` uses permission-aware channel access checks.
- Broadcast delivery performs current-access re-checks before sending channel events.
- `JoinVoice` uses permission-aware voice checks.
- Voice state/control events are filtered by current server membership.
- `Signal` forwarding is constrained to same voice channel participants.

---

Last verified against code on 2026-05-09.
