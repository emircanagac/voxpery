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
{
  "type": "JoinVoice",
  "data": {
    "channel_id": "voice-channel-uuid",
    "participant_sid": "PA_livekit-session"
  }
}
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
    "camera_on": false,
    "reason": "optional moderator reason"
  }
}
```

Behavior:

- Without `target_user_id`, updates self voice controls.
- With `target_user_id`, server moderation controls apply (`MUTE_MEMBERS` / `DEAFEN_MEMBERS`). The target must be active in voice and lower in the server role hierarchy.
- A moderator reason is optional and limited to 500 characters. Server mute/deafen state is not changed unless the corresponding audit entry is persisted.

### `DisconnectVoiceMember`

```json
{
  "type": "DisconnectVoiceMember",
  "data": {
    "target_user_id": "uuid",
    "reason": "optional moderator reason"
  }
}
```

Requires `MUTE_MEMBERS`, `DEAFEN_MEMBERS`, or `MANAGE_SERVER`. The target must be active in voice and lower in the role hierarchy. The affected channel and optional reason are recorded before the voice session is revoked.

### `MoveVoiceMember`

```json
{
  "type": "MoveVoiceMember",
  "data": {
    "request_id": "uuid",
    "target_user_id": "uuid",
    "channel_id": "destination-voice-channel-uuid",
    "reason": "optional moderator reason"
  }
}
```

Requires `MOVE_MEMBERS` or `MANAGE_SERVER`. Source and destination must be different voice channels in the same server, the target must be able to join the destination, and role hierarchy applies. The request remains pending until the target sends `AcknowledgeVoiceMemberMove` after joining the destination LiveKit room. The server verifies the destination participant before source cleanup and audit success. The moderator receives `VoiceMemberMoveResult`; failures and timeouts are not audited as successful moves.

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
- `DmRead`
  - Targeted to the user who read the DM so other open sessions can clear the same unread badge.
  - Payload includes `channel_id`, `user_id`, and `last_read_message_id`.
- `MessageUpdated`
- `MessageDeleted`
- `Typing`

### Presence/User

- `PresenceUpdate` (`online`, `dnd`, `offline`)
- `UserUpdated`

### Friends

- `FriendUpdate`
  - Targeted to each affected user after request, accept, reject, cancel, or remove operations.
  - Clients refresh friend/request snapshots from this event, with reconnect, foreground, and a five-minute visible-session fallback for recovery; do not add short-interval polling.

### Server Membership / Roles / Channels

- `MemberJoined`
- `MemberLeft`
- `MemberRoleUpdated`
- `ServerRolesUpdated`
- `ServerChannelsUpdated`

### Voice

- `VoiceStateUpdate`
  - `channel_id: null` means user left voice.
  - `channel_active_since_ms` is the backend epoch millisecond timestamp for when the channel became non-empty. It is `null` on leave events.
- `VoiceControlUpdate`
  - Includes combined and server-enforced flags:
    - `muted`
    - `deafened`
    - `server_muted`
    - `server_deafened`
    - `screen_sharing`
    - `camera_on`
    - `server_id`
- `VoiceMemberMoveRequested`
  - Targeted event sent only to the moved member after the server validates a `MoveVoiceMember` request.
  - Includes `request_id`, `source_channel_id`, `channel_id`, `server_id`, and `actor_id`; only a client whose active voice session matches the source switches its LiveKit room.
- `VoiceMemberMoveResult`
  - Targeted to the moderator after destination LiveKit verification, failure, or timeout.
  - Includes `request_id`, `target_user_id`, `channel_id`, `success`, and a user-facing `message`.
- `ScreenShareViewerUpdate`
  - Reports an opt-in viewer's current watch state for one active screen-share publisher.
  - Includes `viewer_id`, `publisher_id`, `channel_id`, `server_id`, and `watching`.
  - Delivery is limited to members of the relevant server; the backend accepts updates only when both users are in the same voice channel and the publisher has an active share.

### Low-level

- `Signal`
- `Pong`

## Voice + LiveKit Flow

1. Client requests `GET /api/webrtc/livekit-token`; the backend validates effective voice permissions.
2. Client connects to the LiveKit room and publishes its microphone.
3. Client sends `JoinVoice` over WS only after the media connection succeeds.
4. Backend updates process-local `voice_sessions` and broadcasts voice state/control events. Explicit screen-share watch decisions also create short-lived viewer-presence entries so the stage can show who is watching without subscribing anyone else to media.
5. LiveKit owns the reconnect grace window, so temporary `Reconnecting` state keeps sidebar presence intact.
6. A final room `Disconnected` event sends `LeaveVoice` over the application WebSocket and clears local media state.
7. The signed LiveKit `participant_left` webhook idempotently clears the same backend voice session for suspended or unreachable clients. The participant SID prevents a delayed leave event from removing a newer rejoin. Backend WebSocket cleanup remains the fallback when both connections are lost.

## Security Notes

- `Subscribe` uses permission-aware channel access checks.
- Broadcast delivery performs current-access re-checks before sending channel events.
- `JoinVoice` uses permission-aware voice checks.
- LiveKit webhook payloads require a matching API-key issuer, HS256 signature, expiration, and raw-body SHA-256 claim before they can clear voice state.
- Voice state/control events are filtered by current server membership.
- Screen-share viewer updates are accepted only for users in the same voice channel and are cleared when either participant leaves or the publisher stops sharing.
- `Signal` forwarding is constrained to same voice channel participants.

---

Last verified against code on 2026-08-07.
