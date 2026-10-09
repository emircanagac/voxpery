# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Google sign-in cancellation and callback failures return to web or desktop login with visible errors and preserve the retry destination. Both clients now default to the server list after Google sign-in.

## [0.3.1] - 2026-10-09

### Fixed
- Refresh the current user's server list when another session joins a server, and reconcile membership and profile data after reconnect. Apply own-profile WebSocket updates immediately and show the account creation date in the own-profile preview.
- Registration shows CAPTCHA script/widget failures and provides bounded retry instead of a blank verification area; retries do not bypass provider success or server Siteverify.
- New Google users starting from Sign In can complete legal acknowledgements before account creation instead of being redirected to an unusable registration error.
- Unified session and legal-document restoration into one startup snapshot, removing redundant document checks and their loading screen while preserving server enforcement, outage retry, and account-change guards.
- Sign Up uses a compact two-column desktop form and a single-column mobile form. Email and Google signup consistently require current server-provided legal acknowledgements.
- Failed legal acknowledgement saves preserve the form and selections; account changes and stale responses cannot unlock the wrong session.
- Microphone-denied joins retain an explicit retry path, and failed voice joins release capture and media resources.
- Explicit voice join retries report repeated connection failures instead of silently suppressing an error whose previous notification was dismissed.
- Voice preparation HTTP failures no longer masquerade as a disconnected application WebSocket.
- Voice joins recheck current application connectivity after permission waits and can restart an exhausted active-session socket retry without bypassing offline, logout or authentication-expiry guards.
- Voice participant cues ignore initial and reconnect snapshots; short remote network interruptions no longer sound like a leave and rejoin, while explicit departures still sound immediately.
- Screen shares preserve the entire source frame in normal, focused, and fullscreen views without applying screen-share fitting to camera tiles.
- Restored the original Voxpery fox logo in small desktop window, Windows taskbar and tray icons, replacing the separate wider redraw while retaining DPI-specific icon sizes.
- Local web builds now show the package version when no explicit deployment tag is supplied, keeping the version badge and build metadata aligned.
- Native Windows/WSL QA database and Redis clients use IPv4 loopback to avoid connection fallback delays in voice integration tests without increasing WebSocket deadlines.
- The welcome guide offers direct text navigation and voice joining without duplicate default task or project-link actions, while preserving custom starter tasks.
- Long usernames truncate cleanly in the account dock without squeezing status or settings; the full name remains available on hover.
- Profile photo selection opens a local square crop preview with drag, slider, keyboard, and mouse-wheel zoom. Centered actions keep editing accessible; invalid-file errors appear inside Profile without dismissing Settings. Only Save uploads the edited image; Cancel keeps the current photo, and failed saves can be retried. Transparent PNG/WebP/GIF/AVIF photos keep their transparency (saved as WebP, or PNG where WebP encoding is unavailable); animated GIFs are saved as a still image and the editor says so.
- Legal pages set their own title, description and canonical URL, offer Terms/Privacy/KVKK switching, mark the KVKK text as Turkish for assistive technology, link the Terms to the Privacy Notice, and print as complete documents. A regression test keeps the displayed version aligned with the server-enforced version.
- Web logout ends the browser session even when server-side token revocation fails, and desktop sign-in/sign-out no longer wait for a failed revocation; such tokens are retried from the OS keyring on later starts.
- Desktop Google sign-in and registration no longer leave a signed-in Voxpery session in the system browser; the desktop app receives its session only through the PKCE exchange.
- Google and desktop registration pages share one implementation, so their Terms/Privacy/KVKK links point to the same web origin. Desktop registration start is rate-limited even without a trusted client IP, and expired pending registrations are cleaned up every minute.
- Image attachments appear once their resolved URL is ready instead of briefly rendering the raw signed URL and then re-rendering.
- Newly created servers start with a disabled welcome guide for administrators to configure explicitly. Existing guide preferences are preserved. Profile photo selection errors appear under the photo actions without shifting the profile, and Settings > Profile fits a 1366x768 window again without scrolling.

### Changed
- Desktop email registration can complete in a server-hosted browser form with Siteverify, explicit legal proof, CSRF and single-use PKCE return. Its exchange (`/api/auth/desktop-exchange`) no longer depends on the Google feature flag; desktop v0.3.1 therefore requires a v0.3.1 server for Google and email sign-in handoff. Fixable form errors re-render the form with entered values instead of a raw JSON error. Live CAPTCHA and installed browser-to-app return remain acceptance gates.
- Linux Tauri configures media settings/permissions before the first app document, aligns GTK app ID and URL-aware package launchers, selects Ayatana for Linux builds, and preserves taskbar recovery when backgrounding. Installed-package voice, CAPTCHA and tray acceptance remain pending; this does not claim missing WebRTC support restored.
- CI adds a `Checks / Desktop` job that compiles and tests the Tauri app on Linux when desktop sources change (and on every release tag), and runs repository regression scripts in the frontend job. Docker publish jobs use static names, so skipped PR checks no longer show raw matrix expressions. A change-detection step skips Backend, Frontend and Desktop when a change cannot affect them, so documentation-only PRs finish in seconds while required checks still report.
- Web dependencies are pinned to the exact versions already in the lockfile (security override floors stay ranges), and Dependabot keeps them exact. The build/test-only `source-map-js` dependency is raised to 1.2.2 for a high-severity denial-of-service advisory.
- Screen audio requests unprocessed music/game capture and adds bounded, opt-in, source-matched interval energy/playback diagnostics. Real two-user volume-dip acceptance remains pending.

## [0.3.0] - 2026-10-03

### Added
- Added an idle voice dock shared by server, Friends and DM views, with microphone/deafen preparation before joining. Preferences apply on explicit join, deafen retains both muted indicators and restores the previous microphone choice, and leaving voice preserves the in-session preferences. Idle controls do not capture media or send voice-state commands; camera/sharing remain connection-only.
- Added a lightweight Friend Activity dock showing only active friends in accessible voice channels, with avatars and server/channel context. Sharing friends appear once with a small indicator. Clicking only navigates, without joining voice or watching media. The list scrolls independently above Community/GitHub/About and the separate Support footer.
- Added watched-stream previews that move by dragging the video body and resize from all four corners with one bottom-left icon, fitting the native stream ratio up to 960 px within central content. Retained owner avatars on media cards and removed redundant empty voice cards for participants represented by camera or screen-share tiles.
- Added image/file draft cards with previews, file sizes, reduced-motion-aware upload activity, and retry/remove controls.

### Changed
- Enlarged mobile microphone/deafen touch targets to 44px without resizing icons or the footer; very narrow connected docks retain ping through an accessible icon. Added full-name hover titles to DM/member/voice labels and preserved channel names beside descriptions. Increased DM presence text contrast and size.
- Applied the user-configured microphone shortcut to both idle preparation and connected voice controls, without requesting media access before joining; typing, repeat, push-to-talk conflicts, joining and deafen guards remain intact.
- Refreshed the Social dock with an outlined Friends navigation button, inset conversation rows, balanced section spacing, and theme-aware hover/keyboard-focus hide controls. Touch layouts keep hide actions visible without shifting usernames or unread badges.
- Unified idle and connected voice docks with a shared framed surface, aligned audio controls and responsive sizing; only connected voice uses the green session border.
- Kept voice-control state colors readable while hovered, including the deafen-locked microphone, active camera/sharing and server restrictions.
- Refined Social navigation with an icon-led Friends entry, a conversation count, presence subtitles and separated hide controls; preserved unread, pinning and keyboard behavior.
- Reduced mandatory frontend E2E to tagged basic feature checks and a short mobile smoke set. Detailed visual regressions remain available through an explicit manual command; no new scheduled or parallel CI jobs were added.
- Redesigned voice confirmations into distinct short sound families: rising/falling room melodies, low microphone taps, spaced deafen pulses, bright camera bells, and screen-share chords. Kept the existing sound-effects preference and local/remote event routing, with no downloaded audio assets.
- Refreshed the shared DM, mention and message notification sound into one soft double tap, distinct from camera and voice controls, without changing notification eligibility, sound settings or do-not-disturb behavior.
- Show GIF/sticker favorite stars on hover or keyboard focus instead of keeping saved stars visible while idle; touch devices retain direct favorite access.
- Improved compact composer touch targets without enlarging icons; the mobile character counter appears near the limit. Empty Create, Join and Send actions now display a disabled state.
- Made category and raid audit entries readable, removed the duplicate Audit Log heading, and moved raw raid metadata into expandable event details.
- Simplified the app header to one compact, theme-aware `Beta v0.3.0` badge, without a glowing status dot or animation; the version remains resolved from the running build.
- Made Social direct-message rows and all Friends filter buttons visibly outlined, with theme-aware hover, selected and keyboard-focus states.
- Added simplified Windows small-icon artwork and DPI-specific ICO frames, retaining the original large icons and avoiding a second runtime tray scaling pass.
- Rebuilt Friends with Online, All and Add Friend filters, compact unframed rows, visible message actions and local search. Add Friend combines submission and incoming/outgoing requests, with an incoming-only badge and no duplicate header action; submission supports Enter, pending feedback and duplicate-submit protection.
- Modernized voice-row LIVE, camera and mute/deafen indicators with flat theme-aware Lucide icons. Isolated the fixed-width channel-active-time counter so each second no longer rerenders the channel list; background-tab updates pause and catch up on return.
- Matched participant indicators to call-control colors: red self-mute/deafen, green active camera/sharing, and warning-colored server restrictions. Kept both microphone and headphone indicators while deafened and strengthened microphone/deafen confirmations without changing room or media sounds.
- Restyled Social DMs as compact conversation rows with readable Pinned/Recent headings and a selected-row marker.
- Rebuilt the emoji/GIF/sticker panel with fixed navigation/search, keyboard tabs, clear/close actions, semantic theme colors, and lazy media previews.
- Simplified the landing to fit common desktop viewports and use browser-only entry points below 1024px; highlighted Voxpery's open-source, self-hosting, and chat/call capabilities on Compare.
- Replaced compact Settings tab grids with one section selector and removed decorative gradients, backdrop blur, and shadows from personal and Server Settings surfaces.
- Grouped Quick Search results into Direct messages, Servers, and Channels, with keyboard navigation following the displayed order.
- Allowed `#` in text/voice channel and category names for both creation and renaming.
- Made the footer avatar open the profile and the combined username/status area open status controls.
- Unified narrow desktop and mobile chat layouts below 1024px, keeping channels and members reachable through drawers without squeezing the composer.
- Grouped emoji, GIF, and sticker selection beside attachments, remembering the last selected tab and leaving the character counter and Send on the right.
- Made Custom Light visibly tint the full application palette while preserving readable text and independent accent colors.
- Restored default responsive sidebar widths and removed draggable panel resizing; previously saved custom widths no longer affect layout.
- Made member profile dialogs easier to read with larger avatars, clearer text, and grouped actions without enlarging compact profile rows.
- Moved project support links and repository funding to GitHub Sponsors across the app, public website, and documentation.
- Updated the web and backend dependency sets and refreshed the Voxpery logo image.

### Fixed
- Split the multi-viewport compact-chat regression into isolated tests with independent timeout budgets and updated the theme fixture to use the shared voice-frame class.
- Kept short synthesized-cue envelopes in chronological order and disconnected completed cue audio nodes after playback.
- Added wrapping Up/Down and Home/End keyboard navigation to Friends, DM, channel/category and member/voice action menus, skipping unavailable actions without intercepting sliders or selectors.
- Restored focus to the remounted conversation-search button after Escape or Close, including shortcut-opened search, without stealing focus when Pins replaces search.
- Contained keyboard focus inside attachment image previews and restored the opener on dismissal. Closed compact Social/channel drawers no longer remain in the keyboard or accessibility navigation sequence.
- Prevented repeated or rapid keyboard events from starting overlapping microphone-shortcut saves; verified registration rollback, clearing and supported-key boundaries.
- Restricted signed-attachment cache normalization to the application/API origins; external image URLs retain their complete identity even when their paths resemble the attachment API.
- Narrowed the voice active-time indicator and aligned Send Request with its input; blank/whitespace drafts now have a visibly disabled button instead of an active-looking primary surface.
- Made server-only mute/deafen states visible in voice participant rows with explicit server-enforced labels.
- Aligned the floating-stream hide action with the upper-right corner while preserving clickable button coverage and outer-corner resizing.
- Hid idle server-rail scrollbars and revealed a thin thumb on hover, keyboard focus or drag without moving icons; matched member/DM menu widths and aligned voice menus with participant avatars.
- Fixed Chromium/Brave server-rail scrollbar colors overriding the custom 4 px width, removed native arrow buttons, and preserved Firefox's thin scrollbar without crowding server icons.
- Compacted server welcome guides into an inline, wrapping layout and combined the introduction task with its recommended text-channel button while preserving custom copy, other tasks, channel actions, and dismissal.
- Kept floating streams within visible central content on Friends despite retained hidden chats, and removed the dark owner-label strip so the original video remains visible.
- Kept single favorite/recent/search stickers at regular grid-cell size and moved the latest-message arrow slightly right while retaining scrollbar clearance.
- Separated the Social Friends selection from the header divider, removed the misleading DM heading count, and restored direct compact Settings access beside Quick Search.
- Kept compact Create/Join Server actions above the fixed account dock, including on short landscape screens.
- Kept all Settings account subdialogs anchored to their parent: Cancel, Escape, and backdrop dismissal return to the originating tab and clear private drafts.
- Stopped treating Android and touch-enabled iPads as Linux/macOS desktop download targets.
- Contained keyboard focus in Server Settings and channel/category dialogs, including nested confirmations and opener restoration.
- Expanded compact conversation search and restored public-site mobile navigation with a named menu toggle.
- Named settings, AutoMod, and role-color controls for assistive technology, and clarified that web microphone shortcuts are tab-scoped.
- Removed the full-screen Quick Search blur that slowed list scrolling, and kept pointer hover from triggering automatic list scrolling while retaining keyboard navigation.
- Kept the first active-voice server outline visible and made server reorder targets explicit, including first-position drops and edge scrolling.
- Kept long Safety/Raid Events and Roles cards at their natural height within the Server Settings scroll area.
- Reused authenticated attachment previews across renewed signed URLs, reactions, and channel switches; removed empty horizontal image frames.
- Kept member and voice moderation menus inside the viewport with internal scrolling, accessible volume controls, and preserved keyboard focus; profile dialogs stay visible when their originating sidebar is hidden on a narrow screen.
- Removed the automatic notification opt-in banner and its timer/snooze logic; notification permission remains a manual Settings > Communication action without shifting or covering chat.
- Resumed interrupted voice audio and ended microphone capture on foreground return, with room-scoped recovery and preserved mute/deafen controls; retried exhausted application WebSocket connections without reviving expired or logged-out sessions. Mobile browser background capture remains subject to OS restrictions.
- Kept the Settings frame stable when switching between Profile and other tabs.
- Preserved latest-message positioning through channel/DM changes, delayed media, composer resizing, and same-count content refreshes without overriding deliberate history reading or message targets.
- Replaced the full-width Newest strip with an inset bottom-right arrow that appears after meaningful upward scrolling, without changing the message viewport height or scroll position.
- Kept member, voice participant, and DM action menus clear of their source rows and inside their panel widths, flipping above or scrolling internally when space is limited.
- Added Settings/account dialog focus containment and restoration, accessible auth labels, and keyboard-accessible attachment and auth navigation actions.

### Security
- Updated the development-only `fflate` dependency used by Vitest UI to 0.8.3, fixing GHSA-px8p-9vwx-vf98 without changing runtime dependencies or adding an override.

## [0.2.16] - 2026-09-27

### Added
- Added profile, messaging, appearance, and layout refinements: a direct profile entry point, a clearer message editor, independent light-theme color controls, and resizable side panels.
- Added opt-in voice-join timing diagnostics to help identify capture, connection, and publication delays without changing the voice path.

### Changed
- Kept server-applied voice mute and deafen active across voice rejoin, channel changes, and reconnects until an authorized moderator clears them.
- Made desktop single-key microphone mute shortcuts work while Voxpery is unfocused; web shortcuts remain focus-bound, and mouse buttons cannot be assigned.
- Improved keyboard and focus behavior in chat, server, and dialog navigation, including the external-link warning.

### Fixed
- Restored older DM history pagination, consistent latest-message positioning, and unread clearing while a DM is open.
- Added visible ZIP download start feedback and prevented duplicate downloads from repeated clicks.
- Kept message actions from covering text and showed complete inline photos without cropping them.
- Restored permission-gated self-release from a server voice mute or deafen through the voice participant menu.
- Made public login and registration usable in shorter windows and aligned the landing header across public pages.
- Corrected empty and loading chat states, narrow Social and DM layouts, and several accessible control labels and dialog focus behaviors.

## [0.2.15] - 2026-09-24

### Changed
- Limited pull-request CodeQL scans to changed language areas while retaining complete weekly and manual scans.
- Clarified the Appearance settings hierarchy with separate base-theme and accent controls, compact impact labels, a live accent preview, and explicit global and accent reset actions.
- Kept registered members in the official Voxpery community by removing its Leave Server action and rejecting direct leave requests; other servers can still be left.
- Backfilled existing unbanned accounts into the official community and made Google sign-in require membership before access continues.

### Fixed
- Fixed the Linux desktop build by disambiguating WebKit settings access; platform-specific permission-settings helpers no longer warn on Linux.
- Made ZIP attachments download from chat instead of opening an empty tab, including authenticated desktop blob URLs.
- Kept channel categories and visible channels scoped to the selected server during rapid server switches so old server rows cannot flash into view.
- Re-applied local deafen on LiveKit remote microphone mute-state events so a sender unmuting cannot re-enable playback for a deafened listener.
- Made moderator voice moves reuse an active microphone capture in background tabs, verify through the container-internal LiveKit API instead of a client-facing localhost URL, tolerate delayed destination visibility and SID renewal, report explicit results, and preserve audit success only for identity-verified moves.
- Simplified Appearance into compact theme and accent controls, kept color fields anchored to `#`, capped hex input at six digits, normalized pasted values, and preserved preferences without internal scrolling in the widest layout.
- Made the fullscreen focus action exit browser fullscreen directly into the selected stream's in-app focus view, while keeping fullscreen controls explicit about their enter/exit state.
- Kept the 190-character About me editor at a stable height so resizing cannot disrupt the Profile settings layout.
- Combined the Profile preview and About me editor into one cohesive card, moved its save action beside the character count, and standardized all Profile action sizes.
- Tightened the desktop Profile settings rhythm so the complete section fits without internal scrolling.
- Made voice moderation depend on explicit permissions instead of target role position, matching Discord-style voice controls while retaining hierarchy protection for account moderation.

## [0.2.14] - 2026-08-31

### Added
- Added permission-gated voice member moves and structured moderation audit entries for server mute, deafen, disconnect, and move actions, including target, channel, optional reason, filters, and cursor pagination.
- Added a persistent in-app mini player for watched screen shares when navigating to text chat or Social, with a direct return-to-stream action and independent stop-watching control.
- Added profile-first context menus for Friends and direct-message entries, including viewport-safe positioning and relevant message, pin, close, and friend-management actions.

### Changed
- Made crowded voice stages keep screen and camera tiles prioritized while their grid contracts safely for larger participant counts; tightened desktop voice participant spacing without reducing mobile touch targets.
- Moved the desktop watched screen-share mini player to the upper-right content area while keeping its mobile placement above the bottom dock.
- Replaced inline Friends message and removal controls with one compact more-actions menu, matching the right-click actions and supporting touch devices.
- Refocused release web E2E coverage on isolated core UI regressions, removed legacy stateful browser suites that duplicated backend integration coverage, and enabled Redis-backed rate-limit tests in CI.
- Removed the Vite native-config warning and made asynchronous auth and landing-page tests settle before cleanup, keeping release CI output deterministic.

### Fixed
- Kept remote microphone tracks locally suppressed when a sender unmutes, republishes, or reconnects after the listener has deafened, without muting independently watched screen-share audio.
- Hardened attachment read/open sinks with explicit traversal guards and canonical symlink-boundary checks, removed user-controlled values from integration assertion logs, and kept all configured CodeQL languages present in pull-request scans.
- Kept Friends and direct-message context menus inside the Social sidebar and removed the redundant direct-message open action from existing conversations.
- Kept Friends context menus in the main Social panel, aligned their profile labels with server member menus, and removed friend removal from direct-message menus.

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
