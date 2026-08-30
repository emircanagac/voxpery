# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Added permission-gated voice member moves and structured moderation audit entries for server mute, deafen, disconnect, and move actions, including target, channel, optional reason, filters, and cursor pagination.

### Fixed
- Kept remote microphone tracks locally suppressed when a sender unmutes, republishes, or reconnects after the listener has deafened, without muting independently watched screen-share audio.

## [0.2.13] - 2026-08-29

### Added
- Added a server-enforced, versioned legal-document gate for stale accounts, with atomic Terms, Privacy Notice, and KVKK acknowledgement plus privacy-safe audit evidence.
- Added an in-app theater view for local and watched screen shares so a stream can stay central and prominent without forcing browser fullscreen.

### Changed
- Pinned the production and CI PostgreSQL/Redis images, plus production LiveKit and ClamAV images, to explicit patch releases for repeatable deployments.
- Made the active voice-channel return control easier to recognize and added state-aware hover labels to call controls.

### Fixed
- Made desktop push-to-talk follow global key press and release events while Voxpery is unfocused or minimized, with fail-closed release handling on focus loss and mode changes.
- Stabilized initial watched screen-share audio by coalescing output-device assignment and starting each unchanged remote track only once while subscription events settle.
- Prevented supported browsers from recapturing Voxpery's own call playback into a shared-audio track.
- Unified Firefox, Chromium, and desktop microphone publication behind one RNNoise/Web Audio engine, kept the processing graph alive without local monitor playback, and reconciled built-in voice profiles with stale activation-mode settings so a client cannot silently remain in push-to-talk.
- Restored atomic LiveKit subscription hydration for participants already in a voice room, preventing join order from producing one-way audio while preserving selective camera and screen-share bandwidth controls.
- Kept normal remote microphone and screen audio on native media-element playback across browsers, using an isolated Web Audio gain graph only when a user explicitly amplifies voice above 100%, so Firefox senders remain audible to Chromium receivers without coupling voice and stream volume.

## [0.2.12] - 2026-08-23

### Added
- Published versioned Terms of Service, Privacy Notice, and KVKK notice for the hosted service, together with self-host guidance and a documented data-subject request process.
- Recorded privacy-safe proof of the legal document versions acknowledged during password and Google registration.

### Changed
- Replaced the basic JSON data export with a re-authenticated, size-limited ZIP containing the user's account data, authored messages, avatar, and eligible uploaded files.
- Clarified that the self-service archive is a bounded convenience export rather than a complete formal privacy access response.

### Fixed
- Restored independent desktop playback for every remote microphone and watched screen-share audio source through Tauri-safe direct `MediaStream` outputs, preventing the WebView audio bridge from silencing incoming voice.
- Made deafen synchronously gate every remote microphone bus, including tracks that arrive during reconnect, without muting independently watched screen-share audio.
- Bound the complete Google OAuth state to its HttpOnly cookie so registration intent, legal versions, redirect metadata, and PKCE values cannot be changed before callback validation.

## [0.2.11] - 2026-08-22

### Fixed
- Kept remote microphone and watched screen-share playback stable across local speaking-state changes, preserving independent voice and shared-audio mixing for multi-participant calls.
- Prevented consecutive reaction updates from overlapping virtualized message rows or displacing the reader's scroll anchor.
- Suppressed remote speaking rings while the local listener is deafened, restoring the current indicators immediately after undeafen.

## [0.2.10] - 2026-08-21

### Fixed
- Prevented speaking-state updates from restarting remote microphone or watched screen-share audio, preserving concurrent voice and shared audio in multi-participant calls.
- Restored reliable touch scrolling for long Friends and Requests lists in the mobile Social view.

## [0.2.9] - 2026-08-20

### Changed
- Added deterministic `/version.json` metadata to production web builds so deploy validation checks the exact immutable image tag without depending on lazy bundle contents.
- Strengthened production deploy readiness with three consecutive full-stack health checks covering required services, API health, PostgreSQL, Redis, attachment storage, and web health.

### Fixed
- Restored the original byte content of migration 009 so existing databases retain their recorded SQLx checksum, and added CI enforcement that keeps applied migration history immutable.
- Updated `h2` to `0.4.16` to address `RUSTSEC-2026-0258`, preventing unbounded empty DATA frames from exhausting server resources.
- Restored the CSP-safe automatic desktop Google OAuth handoff and branded fallback page, preserved local passwords when connecting Google, and enabled email recovery for Google-connected accounts.
- Added bounded integration-feature retries and an explicit retry state so transient feature discovery failures no longer silently hide Google Sign-In and password recovery.
- Made automatic production smoke checks tolerate Cloudflare blocks against CI and production-host datacenter IPs by using origin-local API health while retaining independent public web, version, security-header, and cache validation.
- Fixed production deploy smoke checks to require long-lived caching only for fingerprinted Vite assets while allowing stable bootstrap scripts to revalidate.

## [0.2.8] - 2026-08-16

### Added
- Added a wider expression picker with GIPHY search and trending results, persistent GIF favorites, and recent emoji, GIF, and sticker history.
- Added automatic production deployment for published stable GitHub Releases after both immutable Docker images pass validation, while retaining manual redeploy and rollback controls.

### Changed
- Separated per-user microphone volume from per-stream shared-audio volume, with independent mute state and Discord-style ranges of 0-200% for voice and 0-100% for streams.
- Kept explicitly watched screen-share audio playing while Voxpery is hidden or the listener is deafened, without resuming microphone playback.

### Fixed
- Reconciled LiveKit participants with sidebar voice presence and stabilized onboarding-guide visibility during server navigation.
- Improved shared-audio continuity with Opus RED packet-loss resilience and preserved subscriptions across visibility changes and reconnects.
- Prevented user-volume changes from muting, unmuting, or altering screen-share audio preferences.
- Replaced transient or stale `1 ms` voice ping values with stable selected ICE-path RTT, using current WebSocket RTT while WebRTC measurements settle.

## [0.2.7] - 2026-08-14

### Fixed
- Made normal browser reloads revalidate the web app shell, service worker, and stable RNNoise worklet URL so newly deployed releases no longer require a hard refresh, while retaining long-lived caching for fingerprinted assets.
- Made background DM notifications preserve unread state until the refreshed target message is visibly anchored, with a latest-message fallback when the original target is unavailable.
- Made remote screen sharing opt-in per viewer so unwatched video and shared audio consume no media bandwidth, while preserving microphone audio and reconnect behavior.
- Isolated the local screen-share preview from the published capture stream so fullscreen transitions do not rebind or restart the capture track.

## [0.2.6] - 2026-08-09

### Added
- Added persistent, user-scoped text drafts for server channels and direct messages, including safe restoration after reload or desktop restart.
- Added release smoke coverage for draft isolation, failed-send preservation, and low-idle-traffic behavior.

### Changed
- Reduced idle REST traffic by removing six-second friend-request polling, deduplicating DM subscriptions, and extending the event-driven fallback refresh interval.
- Improved screen-share capture and publish adaptation for high-motion 1080p presets while retaining network-aware degradation behavior.
- Updated voice media controls so hiding remote camera or screen share is local, reversible, and does not disconnect microphone audio.
- Refined camera, screen-share, join, and leave audio cues so call events are easier to distinguish without adding stop-event noise.
- Synchronized web, server, and desktop package metadata to `0.2.6` after the `v0.2.5` tag relied on tag-derived build versions.

### Fixed
- Completed desktop Google OAuth handoff recovery and made callback processing idempotent across startup and runtime deep-link delivery.
- Improved microphone device recovery and remote-media attachment reliability across desktop, web, and reconnect paths.
- Prevented first-message content from shifting after server confirmation.
- Completed Light and custom theme contrast coverage across member lists, overlays, modals, and feedback surfaces.
- Corrected attachment signature tampering coverage so the backend regression test always mutates the tested signature.

## [0.2.5] - 2026-08-08

### Added
- Added Default, Dark, Light, and single-color Custom appearance themes with persistent preferences and reset-to-default behavior.
- Added a compact, theme-aware feedback dock linking users to the matching GitHub bug and feature request templates.
- Added privacy-safe, feature-gated operational observability with a fixed event schema.

### Changed
- Sorted open direct messages by recent activity, added persistent DM pinning, and moved pin actions into a compact context menu.
- Reworked channel and category creation into Discord-style compact menus, category actions, and sidebar context menus.
- Tuned the default voice suppression profiles for more natural speech while retaining the noisy-room option.
- Migrated declarative routing imports to React Router 8 and updated the frontend lint dependency chain to ESLint 10.
- Preserved original error causes when wrapping network and microphone-access failures for clearer diagnostics.
- Reduced scheduled dependency audits from daily to weekly while retaining audits on every pull request and manual dispatch.

### Fixed
- Reconciled LiveKit disconnects with sidebar voice presence so departed users no longer remain visible in voice channels.
- Fixed landing login/register navigation and completed the desktop OAuth return flow.
- Stabilized first-message avatar and content alignment and aligned application surfaces with the selected appearance theme.

### Security
- Updated React Router to `8.3.0` to address `GHSA-qwww-vcr4-c8h2`.
- Updated `brace-expansion` to `5.0.8` through the supported ESLint dependency chain to address `GHSA-3jxr-9vmj-r5cp` and `GHSA-mh99-v99m-4gvg`.
- Updated server and desktop `event-listener` lockfile entries to patched `5.4.2` releases that address `RUSTSEC-2026-0221`.

## [0.2.4] - 2026-07-19

### Added
- Added a default onboarding guide to the official Voxpery Community so new users can discover messaging, voice, and project contribution paths immediately.

### Changed
- Bumped web, server, and desktop package metadata to `0.2.4`.
- Sent default login and registration completions to the server/community surface so new users land closer to the official Voxpery Community experience.
- Deferred browser and desktop notification permission requests until the authenticated app is ready and the user accepts a non-blocking in-app prompt.
- Serialized critical DM creation, server bootstrap, member-role replacement, and channel deletion writes so concurrent requests cannot leave duplicate or partial state.
- Ran backend integration and concurrency tests in CI against isolated PostgreSQL and Redis services instead of silently skipping database coverage.
- Registered macOS microphone, camera, screen-recording, and shared-audio permission metadata in desktop bundles and kept remote call playback active across the screen-share picker and app focus changes.
- Clarified the README and hosted landing page around Voxpery's open-source, self-hostable, privacy-focused positioning.
- Deferred authenticated, voice, RNNoise, and desktop-only JavaScript from public routes, reducing initial JavaScript by roughly 75%, with a CI bundle budget to prevent regressions.

### Fixed
- Made attachment uploads, reaction/report/pin limits, and critical multi-table writes rollback safely under failures and concurrent requests.
- Made retryable DM, message, reaction, report, and pin writes idempotent so transport retries cannot create duplicate side effects.
- Preserved message and reaction integrity when concurrent edits, deletes, pins, reports, and channel operations race.

### Security
- Updated Rust `anyhow` lockfile entries to patched `1.0.103` releases that address `RUSTSEC-2026-0190`.
- Updated the server `spin` lockfile entry from yanked `0.9.8` to `0.9.9`.
- Re-checked permissions inside locked database transactions and committed matching audit entries atomically with role and channel mutations.
- Added strict attachment content-signature validation and hardened cookie authentication against cross-site request forgery.
- Required explicit trusted-proxy configuration before accepting forwarded client IP headers.
- Added rate limits for abuse-sensitive authentication, reporting, reaction, pin, and invitation paths.
- Enforced web, API, and desktop security-header policies in CI, including restrictive CSP regression checks.
- Updated vulnerable or yanked Rust and web dependency paths, including `quick-xml`, `anyhow`, and `spin`.

## [0.2.3] - 2026-06-23

### Added
- Added a configurable microphone mute shortcut that works while the web tab is focused and system-wide in the desktop app.

### Changed
- Bumped web, server, and desktop package metadata to `0.2.3`.
- Reduced default screen-share bandwidth, unsubscribe viewer-hidden remote media, and pause incoming remote video while the app is hidden or minimized, keeping microphone audio connected.
- Removed benchmark-only diagnostics controls from user settings and tailored settings copy to web and desktop runtimes.
- Made voice-channel camera and screen-share activity visible before joining, using a compact camera icon and Discord-style `LIVE` badge.

### Fixed
- Anchored the chat `New messages` divider to the actual unread message boundary so local sends, live arrivals, and history pagination cannot move it onto already-read content.
- Updated desktop `quinn-proto` to `0.11.15` to address `RUSTSEC-2026-0185` remote memory exhaustion.
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
