# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed
- Removed the unfinished Saved/bookmark media surface from Social and message actions to keep the core chat experience simpler.

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
