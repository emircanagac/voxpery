# Network Usage Benchmark

Use this checklist when a desktop build appears to consume more bandwidth than
the web client or another voice application. Compare the same machine, network,
channel size, and elapsed time after a clean restart.

## Fixed idle traffic baseline

Before August 2026, authenticated clients requested friend requests every six
seconds and refreshed the DM/friend snapshot every minute. That produced up to
720 REST requests per idle hour before normal WebSocket traffic. Friend request
updates are now driven by the authenticated `FriendUpdate` WebSocket event,
reconnect, and foreground recovery. DM/friend snapshots use those events plus a
five-minute visible-tab fallback, reducing the fixed fallback baseline to at
most 24 REST requests per hour. The social page also no longer duplicates the
global DM channel WebSocket subscription.

The frontend tests reject reintroducing the six-second poll and protect the
five-minute fallback cadence. Desktop updater checks remain event-independent
and run at most once every six hours. Observability remains event-driven and is
disabled by default for self-hosted deployments.

## Measurement scenarios

Measure at least five stable minutes per row after excluding startup and update
downloads. Record process bytes sent/received and average kbps.

| Scenario | Required state |
| --- | --- |
| Idle | No open voice room; no typing or navigation |
| Text chat | One DM or server channel; text only |
| Voice idle | Joined voice; microphones quiet; camera/share off |
| Voice active | Two users speaking normally |
| Camera | One 720p camera publisher and one viewer |
| Screen share | Test Auto, Video, and Gaming profiles separately |

For media scenarios, enable temporary voice diagnostics before joining:

```js
localStorage.setItem('voxperyVoiceDiagnostics', '1')
location.reload()
```

Inspect `window.__VOXPERY_VOICE_DIAGNOSTICS__`. Screen-share measurements must
include actual capture resolution/FPS, outbound bitrate, codec, scalability
mode, and `qualityLimitationReason`. A lower measured FPS or bitrate than the
selected profile can be caused by browser capture, CPU, network congestion, or
the SFU; do not classify it as an application regression without those fields.

Disable diagnostics after the benchmark:

```js
localStorage.removeItem('voxperyVoiceDiagnostics')
location.reload()
```

## Regression triage

1. Confirm there is one `/ws` connection and no reconnect loop.
2. Confirm `/api/friends/requests` is event-driven rather than periodic.
3. Check that hidden or explicitly hidden remote video tracks are unsubscribed;
   remote audio stays subscribed while joined.
4. Separate REST/WebSocket traffic from LiveKit media traffic.
5. Confirm repeated attachment URLs are served from normal browser cache rather
   than downloaded again.
6. Exclude updater downloads and release installation from steady-state totals.
