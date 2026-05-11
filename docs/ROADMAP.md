# Roadmap

## Product Direction

Voxpery is open-source community chat and voice for groups that want hosted access, self-hosting, and ownership of their data.

The project is not trying to beat every communication product in every category at once. The near-term goal is to become the best choice for communities that want real-time voice and text, strong moderation foundations, and ownership of their data without giving up a polished daily experience.

## Product Pillars

### 1. Voice Quality

Voice should feel reliable enough for daily community use:

- Low-latency voice rooms backed by LiveKit.
- Noise suppression and voice activity behavior that avoids keyboard, mouse, fan, and breath noise.
- Screen sharing and media controls that recover cleanly from device/network failures.
- Clear diagnostics for packet loss, reconnects, permission denial, and token errors.

### 2. Community Safety

Communities need moderation tools before they grow:

- Reports, bans, moderation surfaces, and audit logs.
- AutoMod basics for blocked keywords, invite/link filtering, mention spam, and exempt roles/channels.
- Temporary timeouts/mutes and simple raid protection for join/message spikes.
- Moderator workflows that explain what happened and why.

### 3. Onboarding

Joining a server should be understandable without prior context:

- Invite landing pages with server identity, preview, and a clear join CTA.
- Optional rules screen for community servers.
- Welcome guide and suggested channels for first-time members.
- Sensible defaults for new server owners.

### 4. Daily UX Polish

The app should feel calm and dependable during normal use:

- Accurate unread, mention, and notification behavior across web, PWA, and desktop.
- Per-channel mute, persistent read state, and clear notification preferences.
- Search filters for author, channel, date, attachments, pins, and mentions.
- Threads or forum-style channels for larger communities.

### 5. Self-Host Excellence

Self-hosters should be able to operate Voxpery with confidence:

- One-command Docker Compose setup and documented production deployment.
- Backup/restore guidance, health checks, release smoke tests, and operational runbooks.
- Clear admin visibility into database, Redis, LiveKit, storage, email/OAuth, CAPTCHA, and security header health.
- Release and CI gates that stay fast for PRs while keeping manual release checks explicit.

## Recently Completed

- Core text, server, channel, DM, role, permission, and attachment flows.
- LiveKit voice integration, noise suppression improvements, screen sharing, and desktop voice smoke guidance.
- Desktop release hardening for metadata, icons, updater signing, OAuth deep links, release network scope, and Turnstile CAPTCHA rendering.
- PWA support with manifest, icons, and service worker cache.
- Horizontal scaling readiness for app instance identity, Redis-backed coordination, and operational notes.
- Release and CI quality gates with frontend lint, tests, build, manual release smoke, and branch protection guidance.
- Realtime workload performance review and load smoke script for channel activity, reconnect storms, and attachment-heavy rooms.
- Frontend API surface refactor for smaller API modules.

## Current Priorities

1. **Desktop media permission recovery**
   - Help users recover when microphone/camera permissions are denied in the desktop app.
   - Add clear error copy, retry guidance, and desktop-specific smoke coverage.

2. **Community safety foundations**
   - Add AutoMod basics for blocked keywords, links/invites, mention spam, and moderation events.
   - Add temporary timeout/mute actions and simple raid protection.

3. **Unread, mention, and notification polish**
   - Improve per-channel mute, persistent read state, cross-session correctness, and desktop/PWA notification behavior.

4. **Onboarding improvements**
   - Add invite landing, optional rules screen, welcome guide, and suggested channels.

5. **Search and large-community UX**
   - Improve search filters before heavier indexing rewrites.
   - Decide between lightweight threads and forum-style channels.

6. **Self-host admin visibility**
   - Expose health/config status for DB, Redis, LiveKit, storage, optional integrations, CAPTCHA, and release-critical settings.

## Later Exploration

- Native mobile or mobile-wrapped PWA strategy.
- Server-backed push notifications for offline/mobile clients.
- Incoming webhooks, scoped bot tokens, and a future extension/plugin ecosystem.
- End-to-end encryption design.
- Recording/transcription/video-meeting expansion.
- Marketplace for themes, bots, templates, and extensions.

## Non-Goals for the Near Term

- Enterprise omnichannel support.
- Full Slack replacement workflows.
- Heavy all-browser E2E as a required PR gate.
- Speculative large rewrites before measurement shows a bottleneck.

## Community Input

We value community feedback:

- Vote on features in [Discussions](https://github.com/emircanagac/voxpery/discussions).
- Submit feature requests via [Issues](https://github.com/emircanagac/voxpery/issues).
- Open focused PRs with tests and documentation when behavior changes.

---

Last updated: May 10, 2026.

This roadmap is directional and may change based on user reports, security priorities, maintainer capacity, and production feedback.
