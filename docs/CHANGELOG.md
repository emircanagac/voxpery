# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added a configurable microphone mute shortcut that works while the web tab is focused and system-wide in the desktop app.

### Changed
- Reduced default screen-share bandwidth, unsubscribe viewer-hidden remote media, and pause incoming remote video while the app is hidden or minimized, keeping microphone audio connected.

### Fixed
- Made direct-message history open without a false empty state by reusing recent conversations, prefetching on sidebar intent, and deduplicating concurrent history requests.
- Made saved microphone and speaker preferences fall back silently to the system default when a selected device is removed, while preserving available custom devices.

### Security
- Updated the frontend Babel toolchain to patched `@babel/core` releases that prevent arbitrary file reads through crafted `sourceMappingURL` comments.

## [0.2.2] - 2026-06-13

### Changed
- Bumped web, server, and desktop package metadata to `0.2.2`.
- Added tag-publish metadata guardrails plus release-smoke checks for public health, immutable deploy tags, and deployed web version tags.
- Documented the release-bump checklist so future public releases keep package metadata, changelog entries, desktop updater metadata, and visible app version tags in sync.

## [0.2.1] - 2026-06-07

### Added
- Added and expanded voice quality benchmark diagnostics for controlled release validation.
- Added core UI regression coverage for auth, permissions, social/friend flows, server settings, release/settings, invite, and desktop smoke paths.

### Changed
- Required Node.js 24 across the web and CI toolchain.
- Improved manual deploy workflows so main candidates build immutable commit-tagged Docker images before deployment.
- Tuned balanced voice processing for a more natural default speech profile.
- Split composer media actions and aligned direct-message sidebar styling with the server-channel selection model.

### Fixed
- Fixed email verification delivery, duplicate confirmation handling, and consumed-token verified-state rendering.
- Fixed SMTP delivery reliability by preferring IPv4 and resolving SMTP hosts before sending.
- Fixed chat scroll anchoring, media placeholder stability, and compact version badge rendering.
- Persisted hidden direct-message sidebar state and made the social loading path cache-aware/event-driven.
- Hid voice diagnostics unless explicitly enabled for benchmark/debug work.

### Security
- Updated dependency security paths for web and desktop, including esbuild and Tauri desktop transitive dependencies.
- Removed hardcoded crypto-like test fixtures that CodeQL reported.

## [0.2.0] - 2026-06-01

### Added
- Added a friend DM action button in the friends list for quicker direct-message access.
- Added mocked core UI smoke and component regression coverage for the main social, chat, voice, and media surfaces.

### Changed
- Improved friends-list scrolling, tab layouts, and bottom-dock spacing behavior.
- Switched Docker publishing toward immutable release tags, with manual candidate images still available before a release tag is cut.
- Prepared the web, server, and desktop package metadata for the `v0.2.0` release.
- Updated non-breaking web, server, and desktop dependencies.

### Fixed
- Fixed chat scroll anchoring regressions around message loading and channel navigation.
- Fixed direct-message opening, sorting, notification read-state, and mark-as-read behavior.
- Resolved security alerts from an unused server npm manifest and credential-like integration-test fixtures.

### Tests
- Added CI coverage for core UI smoke flows on pull requests.

## [0.1.13] - 2026-05-21

### Changed
- Improved screen share capture profiles and high-motion playback preference for smoother production sharing.
- Separated screen share audio handling from microphone audio controls in voice calls.
- Refreshed the README app preview asset so desktop and mobile screenshots render as one consistent composition.

### Fixed
- Fixed channel switching scroll anchoring so chat navigation stays on the latest messages more reliably.
- Improved mobile screen share preview controls and remote media interaction polish.

### Tests
- Added regression coverage for core chat switching, inline message actions, voice call controls, remote media visibility, and screen share tuning behavior.

## [0.1.12] - 2026-05-19

### Changed
- Improved screen share quality defaults and release smoke coverage for production voice calls.
- Refined release quality, desktop updater artifact verification, and smoke-test sign-off documentation.
- Simplified chat attachment image previews so web and desktop use the same in-app modal behavior.
- Updated desktop icon assets for better taskbar and installer scaling.

### Fixed
- Fixed desktop Google OAuth login return handling.
- Fixed chat scroll position when loading older messages.
- Fixed chat media rendering stability and message row alignment.
- Fixed a test security fixture to avoid static credential-like sample data.

### Chores
- Updated non-breaking Rust and web dependencies.

## [0.1.11] - 2026-05-18

### Added
- Distinct in-call audio cues when remote users start camera or screen share.
- Unread message count synchronization for direct messages.

### Changed
- Improved deployment workflow behavior so manual deploys target updated `main`.

### Fixed
- Fixed remote media start cue behavior for camera and screen share starts.
- Fixed LiveKit voice access revocation for channel and role permission changes.

### Security
- Hardened image proxy SSRF protections.
- Hardened AutoMod normalization and report abuse/rate-limit handling.
- Hardened desktop capabilities, JWT/token checks, OAuth warning logs, and web container least-privilege behavior.

## [0.1.10] - 2026-05-16

### Added
- Voice channel active duration indicators so users can see how long a voice channel has been active.
- Remote media watching controls for voice calls, including hide/show camera and stop-watching screen share behavior.

### Changed
- New accounts now default to allowing DMs from everyone, with the existing setting still available for users who prefer friends-only DMs.
- Settings/Profile now owns the logout action across desktop and mobile for a more predictable account flow.
- Chat media previews now use a more consistent in-app preview model across web and desktop.
- GIF and sticker picker results were cleaned up and deduplicated.

### Removed
- Removed the unfinished Saved/bookmark media surface from Social and message actions to keep the core chat experience simpler.

### Fixed
- Fixed refresh-time placeholder flashes when reopening a server.
- Fixed settings modal layering issues from voice/chat surfaces.
- Fixed mention suggestion positioning, message grouping polish, and chat layout shift cases.
- Fixed GIF/sticker preview and navigation polish so media stays inside the app experience.
- Fixed desktop image preview behavior so chat images can be viewed consistently with web.

## [0.1.9] - 2026-05-15

### Added
- Server onboarding and moderation foundations, including rules, Welcome Guide, AutoMod, timeouts, raid activity, and Safety views.
- Direct messaging, message search filters, notification preferences, channel mute behavior, and unread polish.
- RNNoise-backed voice suppression, voice quality indicators, and release smoke coverage for production voice behavior.
- Desktop startup, tray, window state, updater UX, and media permission recovery improvements.

### Changed
- Server Settings was reorganized into clearer Community and Safety-focused sections.
- Mobile chat, Social/Friends, voice, profile, member list, and settings layouts were polished for smaller screens.
- README, landing visuals, release docs, and PR/release workflows were refreshed for the v0.1.9 cycle.
- Data export now uses a more readable, data-minimized format.

### Fixed
- Fixed camera preview recovery, mobile duplicate-looking sends, mobile friend list scrolling, mobile voice layout regressions, and production RNNoise CSP behavior.
- Fixed dependency audit and CodeQL findings found during the release cycle.
- Improved desktop update preparation so install/relaunch behavior is less fragile.

### Security
- Hardened attachment path handling, avatar image loading, Redis rate limiting, desktop release preflight checks, and data export privacy.

## [0.1.8] - 2026-05-09

### Added
- Redis Pub/Sub WebSocket bus for horizontal scaling readiness.
- PWA manifest, safe service worker caching, and real-time load smoke tests.
- Broader typed frontend API client coverage.

### Changed
- Improved voice noise suppression and sensitivity threshold tuning.
- Expanded architecture, deployment, voice, WebSocket, and release smoke documentation.
- Squashed previous Git history into a cleaner public baseline.

### Fixed
- Fixed stale chat state when switching chats and improved desktop production API fetch behavior.

## [0.1.7] - 2026-04-26

### Added
- Email visibility, verification, and email change support.
- Self-hosted feature gating for optional integrations.
- Production diagnostics and smoke-test documentation.

### Changed
- Improved WebSocket reconnect, voice resync reliability, desktop updater validation, and release hardening.

### Fixed
- Fixed desktop attachment behavior, production API connectivity, and dependency security alerts.

## [0.1.6] - 2026-04-18

### Added
- About / Download landing page and backend-powered latest release lookup.

### Changed
- Improved voice processing, suppression tuning, mobile navigation, release metadata, and release build hardening.

### Fixed
- Hardened password reset and attachment upload/download behavior.

## [0.1.5] - 2026-04-12

### Added
- Newest shortcut for returning to the latest messages.

### Changed
- Improved composer, scroll, saved media, mobile voice bar, compact viewport, and unread badge behavior.

### Fixed
- Fixed owner leave-server guidance, mobile overlay/layout issues, reply/composer edge cases, and desktop autostart detection.

## [0.1.4] - 2026-04-11

### Added
- Global quick switcher, report flows, reports tab, channel descriptions, new messages divider, and desktop unread indicators.

### Changed
- Improved invite/onboarding, friends/DM empty states, chat navigation, mentions, mobile touch targets, and server settings navigation.

### Fixed
- Fixed reconnect stale data, failed/sending message resilience, attachment retry/access behavior, desktop tray unread behavior, settings modal stacking, and bootstrap flashes.

## [0.1.3] - 2026-04-05

### Changed
- Synchronized desktop version metadata across configuration files.

## [0.1.2] - 2026-04-04

### Added
- Signed desktop updater support, startup/tray settings, chat date separators, and broader emoji/reaction support.

### Changed
- Improved installer/update behavior, Settings and Server Settings polish, role editor consistency, chat interactions, and attachment handling.

## [0.1.1] - 2026-03-29

### Added
- First public release of Voxpery with real-time servers, channels, DMs, LiveKit voice, web/desktop clients, authentication, roles, attachments, account export/delete, Docker Compose deployment, and CI/release workflows.

## [0.1.0] - 2026-03-14

### Added
- Initial pre-public release structure.
