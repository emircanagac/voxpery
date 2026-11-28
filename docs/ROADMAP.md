# Roadmap

## Product Direction

Voxpery is a small group's own voice and chat server: voice channels, screen sharing and chat for a friend group, a gaming group or a small community of about 5 to 50 people, on a server they own and can run for about the price of a chat subscription.

The near-term goal is not to match every feature of larger platforms. It is to be the easiest way for such a group to have reliable voice, screen sharing and chat that they control: one command to install, low running costs, a familiar layout, and no telemetry.

## Product Pillars

### 1. Voice and Screen Sharing

Voice should feel reliable enough for every evening:

- Low-latency voice rooms backed by LiveKit, with noise suppression that avoids keyboard, fan and breath noise.
- Calls that survive short network drops, phones in the background, and people without a microphone.
- Screen sharing that stays light on the computer sharing it.
- Clear diagnostics for permission denial, reconnects and token errors.

### 2. Easy and Cheap Self-Hosting

Running Voxpery should not need a sysadmin:

- One-command Docker Compose setup with HTTPS, on x86-64 and arm64 servers.
- Measured resource use (see [Resource Usage](RESOURCE_USAGE.md)), backups, health checks and runbooks.
- Operator tools for the server: health of the database, Redis, LiveKit, storage and email, account controls and storage quotas.

### 3. Group Safety

A group should be able to keep bad actors out without effort:

- Reports, bans, timeouts that also cover voice, and an audit log of permission changes.
- AutoMod basics and raid protection for join and message spikes.
- Blocking a user and sensible defaults for new server owners.

### 4. Daily UX Polish

The app should feel calm and dependable during normal use:

- Accurate unread, mention and notification behavior across web, phone and desktop.
- Smooth switching between channels and servers, and messages that keep their order.
- A familiar layout that works the same in Chrome, Firefox, Brave, Opera and the desktop apps.

## Recently Completed

- 0.7.0: listening in voice without a microphone, phone calls that go on in the background, a typing indicator, invite previews for visitors, timeouts that cover voice, account disabling for operators, arm64 server images, system notifications on Windows, and steadier chat switching.
- 0.6.0 and 0.6.1: notifications while Voxpery is closed, unread badges kept by the server across devices, one-command setup with HTTPS, invite link reset, registration modes for self-hosters, and short network drops that keep the call.
- Community safety: reports, bans, timeouts, AutoMod (blocked keywords, invite and link filters, mention spam, exempt roles and channels), raid protection for join, message and invite bursts, and a filterable audit log.
- Desktop: Tauri 3 apps for Windows, macOS and Linux (including Flatpak), signed updates, OAuth deep links, keyring sessions, and voice on Linux through Chromium.
- Hosted service: legal notices checked against the code, a self-service data export, and 14-day retention for logs and backups.
- Quality gates: lint, unit tests, core UI smoke in Chromium and Firefox, mobile smoke, server integration tests, desktop checks, CodeQL and dependency audits on every PR.

## Current Priorities

1. **Getting to the first groups**
   - Clear README and home page, a short demo, a tested install guide, and the first public announcement.

2. **Blocking users**
   - Let anyone block someone who bothers them: no direct messages or friend requests in either direction.

3. **Calls in direct messages**
   - Voice, camera and screen sharing in one-to-one and group direct messages, after blocking is in place.

4. **Operator tools**
   - A small admin screen for health, accounts and storage quotas on self-hosted servers.

5. **Lighter screen sharing and faster starts**
   - Measure CPU use while sharing and how long the desktop app takes to start, then fix what the numbers show.

## Later Exploration

- Native mobile apps, mainly for calls that keep going with a locked screen.
- Incoming webhooks, scoped bot tokens, and a future extension or plugin ecosystem.
- End-to-end encryption, revisited once direct-message calls exist.
- Threads or forum-style channels for larger communities.
- Recording, transcription and larger video meetings.

## Non-Goals for the Near Term

- Enterprise omnichannel support or full Slack replacement workflows.
- Running the full visual E2E matrix on every PR; PRs run the core smoke in Chromium and Firefox and the detailed suites run before releases.
- Speculative large rewrites before measurement shows a bottleneck.

## Community Input

We value community feedback:

- Vote on features in [Discussions](https://github.com/emircanagac/voxpery/discussions).
- Submit feature requests via [Issues](https://github.com/emircanagac/voxpery/issues).
- Open focused PRs with tests and documentation when behavior changes.

---

Last updated: November 28, 2026.

This roadmap is directional and may change based on user reports, security priorities, maintainer capacity, and production feedback.
