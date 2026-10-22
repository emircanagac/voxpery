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
- Community safety: reports, bans, timeouts, AutoMod (blocked keywords, invite and link filters, mention spam, exempt roles and channels), raid protection for join, message, and invite bursts, and a filterable audit log.
- Onboarding: invite previews for visitors, server rules, and an onboarding guide for new members.
- Daily UX: unread and mention badges, per-channel mute, direct-message read state shared across your sessions, a message search panel with author and attachment filters, and "New messages" dividers.
- Voice: LiveKit voice with noise suppression, screen shares at their real aspect ratio, a Discord-style focus view, and one voice session per device with "Join here" to move a call.
- Desktop: Tauri 3 apps for Windows, macOS, and Linux (including Flatpak), signed updates, OAuth deep links, keyring sessions, and voice on Linux through Chromium.
- Hosted service: legal notices checked against the code, a self-service data export, and 14-day retention for logs and backups.
- Quality gates: lint, unit tests, core UI smoke in Chromium and Firefox, mobile smoke, server integration tests, desktop checks, CodeQL, and dependency audits on every PR.

## Current Priorities

1. **Voice stage and focus view**
   - Show a clear joining state, keep the focus view inside one screen, and finish its improvements: focusing a camera, remembering the participant strip, leaving with Esc, speaking rings, and a scrollable strip for large calls.

2. **Desktop reliability**
   - Make fullscreen from a maximized window cover the whole screen on Windows, and reopen the window in front after an in-app update.

3. **Browser coverage**
   - Keep Chrome, Firefox, Brave, Opera, and the desktop apps working equally well, with Firefox in CI and a manual browser pass before each release.

4. **Self-host admin visibility**
   - Expose health and configuration status for the database, Redis, LiveKit, storage, optional integrations, CAPTCHA, and release-critical settings.

5. **Large-community UX**
   - Decide between lightweight threads and forum-style channels.

## Later Exploration

- Native mobile apps, or a store-packaged version of the installable web app.
- Server-backed push notifications for offline and mobile clients.
- Incoming webhooks, scoped bot tokens, and a future extension or plugin ecosystem.
- End-to-end encryption, revisited once direct-message calls exist.
- Recording, transcription, and larger video meetings.
- A marketplace for themes, bots, templates, and extensions.

## Non-Goals for the Near Term

- Enterprise omnichannel support.
- Full Slack replacement workflows.
- Running the full visual E2E matrix on every PR; PRs run the core smoke in Chromium and Firefox and the detailed suites run before releases.
- Speculative large rewrites before measurement shows a bottleneck.

## Community Input

We value community feedback:

- Vote on features in [Discussions](https://github.com/emircanagac/voxpery/discussions).
- Submit feature requests via [Issues](https://github.com/emircanagac/voxpery/issues).
- Open focused PRs with tests and documentation when behavior changes.

---

Last updated: October 23, 2026.

This roadmap is directional and may change based on user reports, security priorities, maintainer capacity, and production feedback.
