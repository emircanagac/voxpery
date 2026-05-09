# Performance Review

This document tracks performance risks for larger real-time Voxpery workloads. It is intentionally measurement-first: avoid speculative rewrites, capture likely bottlenecks, then turn confirmed issues into scoped follow-up work.

## Current Scope

Reviewed areas:

- WebSocket fan-out and Redis Pub/Sub bridge.
- Client reconnect behavior.
- Voice state/control signaling.
- Message list/search queries.
- Attachment upload, hydration, and signed content serving.
- Existing smoke, chaos, and multi-user regression scripts.

Not reviewed yet:

- Browser rendering performance with very large channel histories.
- Multi-backend-pod load under a real reverse proxy.
- LiveKit media-plane capacity; this review focuses on Voxpery signaling and app APIs.

## Initial Findings

### WebSocket Fan-Out

Current behavior:

- Each backend instance uses `tokio::broadcast` for process-local fan-out.
- Redis Pub/Sub mirrors broadcast and targeted user events across instances.
- Delivery is authorization-aware: server re-checks channel visibility, friendship/shared-server visibility, or server membership before sending events to a socket.

Likely scaling risks:

- Delivery-time permission checks can become expensive during high-volume channels because each connected socket may perform database checks for broadcast events.
- Presence and profile updates call shared-server/friendship checks per recipient, which can become noisy in large servers or reconnect bursts.
- Broadcast lag is logged, but there is no thresholded metric or load test that quantifies when lag starts.

Recommended next step:

- Add a lightweight WebSocket load script that creates many authenticated sockets, subscribes them to channels, sends message bursts, and records delivery latency plus broadcast lag warnings.

### Reconnect Storms

Current behavior:

- The web client uses exponential backoff with jitter.
- The backend rate-limits WebSocket connection attempts per user.
- `chaos:reconnect` verifies a two-user reconnect and voice state recovery path.

Likely scaling risks:

- Existing reconnect coverage is correctness-oriented, not load-oriented.
- There is no script that simulates many users reconnecting after a deploy, proxy restart, or network flap.

Recommended next step:

- Extend reconnect testing with a configurable socket count and reconnect burst profile before changing backoff behavior.

### Voice State And Signaling

Current behavior:

- LiveKit handles the media plane.
- Voxpery tracks voice session/control state in memory for signaling/UI state.
- Sticky WebSocket routing is still recommended for multi-instance voice until this state is externalized.
- Joining voice iterates current `voice_sessions` to send existing occupants to the joining user.

Likely scaling risks:

- Voice state iteration is fine for small/medium rooms, but should be measured for larger rooms.
- Multi-instance voice state remains a known constraint because `voice_sessions` and `voice_controls` are process-local.

Recommended next step:

- Measure join latency for larger voice rooms before externalizing voice state. Keep LiveKit capacity analysis as a separate operations task.

### Messages And Search

Current behavior:

- Message pagination uses `(channel_id, created_at DESC)` indexes.
- Message fetching avoids N+1 author lookups with joins.
- Reactions are hydrated in batches.
- Search uses `ILIKE '%term%'`, rate-limited per user/channel.

Likely scaling risks:

- Search will not scale well for large channels without full-text indexing.
- Attachment hydration currently resolves attachment records per message attachment payload, which is acceptable for small pages but should be measured for attachment-heavy rooms.

Recommended next step:

- Add query-plan checks for high-row channels before introducing full-text search or attachment hydration batching.

### Attachments

Current behavior:

- Uploads are rate-limited.
- Image metadata stripping is moved to `spawn_blocking`.
- Local content serving reads the full attachment into memory before responding.
- Signed attachment ACL checks include JSONB containment lookups against message attachment arrays.

Likely scaling risks:

- Large concurrent downloads can increase memory pressure because files are read into memory.
- JSONB containment checks may need indexing or a normalized attachment-message join table if attachment-heavy rooms become common.

Recommended next step:

- Measure concurrent signed content downloads and attachment-heavy message reads before changing storage layout.

## Existing Coverage

Available scripts:

- `npm run smoke:e2e`
- `npm run chaos:reconnect`
- `npm run regression:multi-user`
- `npm run load:realtime`
- `npm run rate-limit:check`

`load:realtime` is the first lightweight measurement script. It records message delivery latency, post-reconnect ping latency, and voice-state fan-out latency against a running backend.

Remaining coverage gap:

- Existing scripts still do not record throughput over long soak windows, server-side memory pressure, Redis Pub/Sub lag, or database query plans under seeded large channels.

## Local Baseline

Baseline run:

- Date: 2026-05-09
- Command: `npm run load:realtime`
- Target API: `http://127.0.0.1:3001`
- Users: 5
- Messages: 12
- Reconnect users: 3

Results:

- Message delivery latency: count `60`, p50 `17ms`, p95 `27ms`, max `28ms`
- Post-reconnect ping latency: count `3`, p50 `3ms`, p95 `11ms`, max `11ms`
- Reconnect burst: `3` users, elapsed `511ms`
- Voice state fan-out latency: count `25`, p50 `6ms`, p95 `8ms`, max `9ms`

Outcome:

- No immediate realtime performance blocker was found in this local baseline.
- Keep the default synthetic user count at `5` because the backend intentionally allows a maximum of five registrations per IP per hour.

## Recommended Follow-Up Order

1. Capture baseline p50/p95 event delivery latency and server broadcast lag warnings on a local dev stack with `npm run load:realtime`.
2. Run `EXPLAIN ANALYZE` for message list, message search, and attachment ACL queries against seeded larger channels.
3. Decide whether delivery-time permission checks need short-lived caching after measurements.
4. Decide whether attachment serving should stream files instead of reading full files into memory after download concurrency measurements.
5. Add longer soak/load coverage only after the lightweight script exposes useful baseline numbers.

## Current Recommendation

No immediate production blocker was found in the static review. The code already has useful safety rails: WebSocket rate limits, reconnect jitter, indexed message pagination, Redis Pub/Sub fan-out, and release smoke/regression scripts.

The highest-value next implementation after this baseline is query-plan and attachment download measurement, not optimization. Promote confirmed bottlenecks into focused P1/P2 tasks.
