# Privacy-Safe Observability

Voxpery can emit aggregate operational counters for critical web, desktop, realtime,
voice, and media flows. The feature is designed to answer whether a flow started,
succeeded, failed, or recovered without collecting behavioral analytics.

## Defaults and Configuration

Operational observability is disabled by default for self-hosted deployments.

```env
OBSERVABILITY_ENABLED=true
OBSERVABILITY_RATE_LIMIT_MAX=120
OBSERVABILITY_RATE_LIMIT_WINDOW_SECS=60
```

The backend publishes the enabled state through `GET /api/system/features`. Clients
send no events after the feature is reported as disabled. Event delivery is
best-effort and never changes product behavior when the endpoint or network fails.

## Data Contract

`POST /api/system/observability/events` accepts exactly two fields:

```json
{
  "event": "voice_join_succeeded",
  "client": "web"
}
```

`client` is either `web` or `desktop`. Unknown fields and event names are rejected.
The allowlisted client event codes are:

- `frontend_session_started`, `frontend_crash`
- `desktop_oauth_return_received`, `desktop_oauth_return_succeeded`, `desktop_oauth_return_failed`, `desktop_oauth_setup_failed`
- `websocket_reconnect_started`, `websocket_reconnect_succeeded`, `websocket_reconnect_exhausted`
- `voice_join_started`, `voice_join_succeeded`, `voice_join_failed`
- `livekit_reconnect_started`, `livekit_reconnect_succeeded`, `livekit_disconnected`
- `media_microphone_started`, `media_microphone_failed`
- `media_camera_started`, `media_camera_failed`
- `media_screen_share_started`, `media_screen_share_failed`

The backend also emits `backend_http_5xx` with only the numeric response status.

Voxpery does not attach message content, attachment names, URLs, route paths, request
bodies, stack traces, error messages, tokens, email addresses, usernames, user/server/
channel identifiers, device labels, media details, or raw IP addresses to these events.
Events are not written to the application database.

## Abuse Protection and Logs

The public event endpoint is rate-limited. The Redis key uses a SHA-256 fingerprint
derived from the client address and the deployment JWT secret; the raw address is not
stored in the key or event log. Redis expires the fingerprint after the configured
rate-limit window plus a 60-second cleanup buffer.
Rate-limit and Redis failures return an empty `204` response so observability cannot
become a user-facing dependency.

Structured events use the `voxpery_observability` tracing target and
`privacy_safe_event` message. Hosted operators should retain these logs for no more
than 14 days, exclude them from long-lived backups, and publish only aggregate counts.
Changing that policy requires a matching documentation and privacy review.

## Reliability Metrics

Calculate ratios over the same deployment version and time window:

- Error-free frontend sessions: `1 - frontend_crash / frontend_session_started`
- Desktop OAuth completion: `desktop_oauth_return_succeeded / desktop_oauth_return_received`
- Voice join success: `voice_join_succeeded / voice_join_started`
- WebSocket recovery: `websocket_reconnect_succeeded / websocket_reconnect_started`
- LiveKit recovery: `livekit_reconnect_succeeded / livekit_reconnect_started`
- Media start success: `media_*_started / (media_*_started + media_*_failed)`

Treat small samples cautiously. These counters identify a regression area; they do
not identify a user or explain the content of an individual failure.
