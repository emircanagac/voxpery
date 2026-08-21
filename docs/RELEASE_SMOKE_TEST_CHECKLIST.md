# Release Smoke Test Checklist

Use this checklist for every production release candidate before tag/publish.

For releases that touch voice, WebRTC, LiveKit, service workers, build output, or audio settings, also complete `docs/VOICE_RELEASE_SMOKE_TEST.md`. If the release touches noise suppression, CSP, service workers, build output, or production deployment config, also complete `docs/VOICE_SUPPRESSION_SMOKE_TEST.md`.

## Release Candidate Info

- Version:
- Commit SHA:
- Git ref / tag:
- Deploy channel:
- Docker image tag:
- Web URL:
- API URL:
- Release type: `web-only` / `desktop` / `voice` / `security` / `hotfix`
- Tester:
- Date (UTC):
- Environment:
- Release / Smoke workflow run URL:
- Desktop artifact workflow run URL, if applicable:

## 1) Required PR Gates (must be green)

- [ ] `Checks / Secret Scan`
- [ ] `Checks / Backend`
- [ ] `Checks / Frontend` (lint, unit tests, core UI smoke, build)

## 2) Security and Release Gates (mandatory)

- [ ] Relevant `Security / CodeQL` analyzers are green or did not run because no matching files changed.
- [ ] `Security / Dependency Audit` is reviewed; unresolved upstream-blocked advisories have an explicit release decision recorded.
- [ ] Web container health responds through the host mapping (`curl -f http://localhost:${WEB_PORT:-5173}/healthz`) while the container uses unprivileged nginx on internal port `8080`.
- [ ] Remote avatar/server icon/inline media proxy rejects localhost/private targets and still loads normal public HTTPS images.
- [ ] Manual `Release / Smoke` workflow completed successfully against the release candidate API.
- [ ] Manual `Release / Smoke` workflow completed successfully against the release candidate web URL.
- [ ] Manual `Release / Smoke` workflow run URL is recorded in Release Candidate Info.
- [ ] Tag-triggered `Release / Metadata` check passed for web, server, desktop, and changelog version-bearing files before Docker publishing.
- [ ] `Release / Smoke` validated strict API `/health` and web `/healthz` security headers, including HTTPS HSTS, frame denial, MIME sniffing protection, referrer policy, Permissions Policy, and surface-specific CSP.
- [ ] CI/release workflows ran against the exact release commit SHA or tag recorded above.
- [ ] Docker images were built with an immutable `sha-<commit>` or `vX.Y.Z` tag, and production deploy did not use `latest`.
- [ ] For `main-candidate` deploys, the manual deploy workflow built and published Docker images for the exact candidate ref before starting deploy.
- [ ] Stable GitHub Release publishing automatically waited for both immutable Docker images and deployed their exact shared `vX.Y.Z` tag; any intentional manual redeploy is recorded instead.
- [ ] Release deploy guardrails verified registry presence for both images, three consecutive origin stack health checks, public web `/healthz`, immutable image tag format, stable entry-point cache policy, and the exact `/version.json` image tag.
- [ ] Production top bar shows the expected `Beta` version badge tag (`vX.Y.Z` or `sha-<commit>`).

## 3) Web Smoke Tests (mandatory)

- [ ] Register works.
- [ ] Login works.
- [ ] Password reset request + reset flow works.
- [ ] A Google-only account can request an email reset, establish a local password, sign in with that password, and remain connected to Google.
- [ ] Connecting Google to an existing email/password account does not invalidate the existing local password.
- [ ] Google OAuth login works.
- [ ] Server/channel/category permission scenarios work.
- [ ] Invite links show the target server, enforce community rules acknowledgement when rules exist, and join into the expected server.
- [ ] Voice join/leave works.
- [ ] `docs/VOICE_RELEASE_SMOKE_TEST.md` completed and recorded as `GO` for voice behavior when the release touches voice, LiveKit/WebRTC, camera, screen share, audio settings, service worker caching, desktop runtime, or build output.
- [ ] `docs/VOICE_QUALITY_BENCHMARK.md` completed and recorded as `GO` when the release changes codec, bitrate, capture constraints, suppression tuning, VAD/gate thresholds, input gain, or LiveKit publish options.
- [ ] Voice access revocation works: kick, ban, moderator disconnect, and removing `Connect to Voice` immediately remove the affected user from the active voice room.
- [ ] Camera self-preview recovers after switching from an active voice channel to another chat, DM, or server and then returning, while the remote user keeps seeing the camera feed.
- [ ] Remote camera and screen-share tiles can be hidden and shown again without leaving voice; hiding media unsubscribes its remote publications for that viewer while normal microphone audio continues.
- [ ] In a call with at least three participants, local or remote speaking-state changes do not restart, mute, or interrupt watched screen-share audio; voice and stream audio remain independently audible.
- [ ] Screen share quality presets match the UI summary: Presentation uses 1080p30 at 4 Mbps, Video uses 1080p60 at 6 Mbps, Gaming uses 1080p60 at 8 Mbps, and Auto does not promote monitor sharing to Gaming.
- [ ] Hiding or minimizing the app pauses incoming remote video subscriptions while voice audio continues, and restoring visibility resumes video without replaying media-start cues.
- [ ] Moderation flows (kick/ban/timeout/clear-timeout) work.
- [ ] Timed-out members cannot send/edit server-channel messages or add new reactions until cleared or expired.
- [ ] Mobile server chat shows one visible message after send, including after the API response and WebSocket echo both arrive.
- [ ] Mobile Social/Friends list scrolls when the visible friend or request list exceeds the viewport.
- [ ] Safety moderation view shows open reports, active timeouts, and recent raid events.
- [ ] Repeated user/message report submissions for the same target do not create duplicate open reports, and rapid report spam returns `429`.
- [ ] Server Settings opens and remains scrollable on desktop; mobile still shows the desktop-only guidance instead of a broken settings modal.
- [ ] AutoMod rule create/edit/enable/disable/delete works and blocked messages do not persist or broadcast, including blocked keywords split with invisible zero-width/bidi characters.
- [ ] Raid protection records message bursts, invite spikes, and join burst signals in audit/moderation activity without exposing private secrets.
- [ ] Category overrides work for `View Channel`, `Send Messages`, `Connect to Voice`.
- [ ] Unread badges, per-channel mute, server mention notifications, DM notifications, and friend request notifications behave correctly across refresh, PWA, and desktop; clicking a background DM notification opens and visibly anchors its target (or the refreshed latest message) before clearing unread state.
- [ ] DM pins persist across refresh/login, pinned conversations stay above activity-sorted unpinned DMs, and a hidden DM returns only after explicit reopen or new message activity.
- [ ] Channel managers can create channels from the compact header menu, a category `+`, and the category context menu; non-managers see none of these controls.
- [ ] Appearance offers Default, Dark, Light, and Custom choices; Custom generates a readable palette from one valid hex color, the independent accent swatches/hex override theme buttons and highlights with readable foreground contrast, both preferences persist after reload, accent reset preserves the theme, and `Reset defaults` restores the original Voxpery palette without horizontal overflow on desktop or mobile.
- [ ] The fixed bottom-right feedback dock shows theme-aligned `Report a bug` and `Request a feature` actions that open the matching GitHub issue templates on web and desktop; it stays outside information sidebars and is hidden on mobile so chat/composer width is unchanged.
- [ ] Login and registration do not open a native notification permission prompt; the delayed in-app prompt requests permission only after the user selects `Enable`, and `Not now` suppresses it during the snooze window.
- [ ] Web app is installable as a PWA; a normal reload (without `Ctrl+F5`) discovers the current release; the app shell and `/sw.js` require revalidation; and the service worker does not cache API, auth, WebSocket, or navigation responses.
- [ ] Production voice call with noise suppression on does not reuse a stale cached RNNoise worklet after deploy.
- [ ] Uploaded chat image attachments render inline after channel/server navigation and open only in the in-app preview modal on web and desktop, with no external tab/browser navigation.
- [ ] Automated core UI smoke includes invite/join, server settings, social/friend, auth/account, release/settings, permission, and desktop-runtime regressions.
- [ ] Automated mobile web smoke completed for the release candidate or CI run, covering Social, DM, server chat, mobile composer actions, and the mobile member sheet.

## 4) Desktop Smoke Tests (mandatory)

- [ ] Installer opens with Voxpery app name and icon (not default NSIS icon).
- [ ] App opens maximized by default and reaches login screen.
- [ ] After resize/unmaximize and restart, the desktop app restores the user's last size, position, and maximized state.
- [ ] Fresh desktop install enables `Launch on startup` by default, and disabling it from settings persists across restart.
- [ ] Windows startup launch keeps Voxpery in the background/tray, and opening it from the tray shows a maximized window.
- [ ] Production desktop build connects only to the official API and does not allow localhost API scopes.
- [ ] Desktop register screen renders CAPTCHA and new account registration succeeds when production CAPTCHA is enabled.
- [ ] With Voxpery closed, Google OAuth opens the browser, starts the desktop app via `voxpery://`, and completes sign-in without requiring a second callback click.
- [ ] With Voxpery already running, Google OAuth returns to and focuses the existing desktop instance.
- [ ] If the browser blocks automatic external-protocol navigation, the `Open Voxpery` fallback completes the same sign-in flow.
- [ ] The desktop callback response applies its branded CSS and automatic handoff script under a nonce-only CSP, and the response is never cached.
- [ ] OAuth cancellation/failure renders the branded responsive handoff state, and `Return to Voxpery` opens the desktop login error state without exposing tokens or raw provider errors.
- [ ] Repeating the same callback through native pending links, `getCurrent()`, and runtime events exchanges its one-time code only once.
- [ ] Session is restored after OAuth callback, the one-time code is not exchanged twice, and the user lands on the requested authenticated route.
- [ ] If updater artifacts are enabled, signing keys and updater pubkey are configured (see `docs/DESKTOP_RELEASE_HARDENING.md`).
- [ ] Desktop release workflow ran against the exact release tag/ref, with `smoke_checklist_confirmed=yes`.
- [ ] Production desktop releases used `platform=all`; single-platform workflow runs are recorded as test/hotfix-only.
- [ ] GitHub Release assets include `latest.json`, installer artifacts for the intended platforms, and matching `.sig` files for updater assets.
- [ ] Desktop release workflow artifact validation passed for every built platform.
- [ ] `latest.json` version matches the release tag and desktop app version.
- [ ] `latest.json` URLs point to assets on the same GitHub Release, not a draft-only, private, or unrelated artifact URL.
- [ ] Updater check shows a clear no-update state when no newer version is available.
- [ ] Updater check shows the available version when a newer signed release is available.
- [ ] Update availability appears as one calm toast plus a compact install pill; settings still provides manual check/install.
- [ ] Desktop settings still exposes app updates, launch-on-startup, and tray-on-close controls when the web shell runs inside Tauri.
- [ ] Updater install path prepares the desktop runtime before install/relaunch.
- [ ] Failed updater check/install shows recoverable UI and does not leave settings stuck.
- [ ] Linux desktop test host has `xdg-desktop-portal` + (`xdg-desktop-portal-gtk` or `xdg-desktop-portal-kde`) and `pipewire` running.
- [ ] First voice join shows OS/browser microphone permission prompt when needed.
- [ ] Voice join succeeds after permission grant.
- [ ] Active call bar quality indicator shows a colored Wi-Fi icon and current ping while connected, and the visible color matches the visible ping value.
- [ ] Voice join and leave cues are distinct enough to tell whether a member entered or left the channel.
- [ ] While already in a voice channel, remote camera and screen-share starts play distinct media cues; stopping camera or screen share stays silent, and joining a channel with existing remote media does not replay old media-start cues.
- [ ] Reconnecting state shows a clear one-time warning without disconnecting the user from the channel.
- [ ] Denying desktop microphone permission shows recovery guidance, opens OS privacy settings from Voice & Audio, and succeeds after permission is restored and retried.
- [ ] Denying desktop camera permission shows OS-specific recovery guidance, opens OS privacy settings when supported, and succeeds after permission is restored and retried.
- [ ] Voice settings mic test with noise suppression on and `Noisy room` selected does not pass normal keyboard, mouse, fan, or breath noise as speech.
- [ ] Real production voice call with noise suppression on and `Noisy room` selected suppresses clap, keyboard, and room-noise bursts similarly to the local Docker build.
- [ ] Production web CSP includes `script-src 'wasm-unsafe-eval'` so RNNoise WebAssembly can compile under strict headers.
- [ ] Production web CSP `connect-src` does not include `localhost` or `127.0.0.1` loopback targets.
- [ ] Desktop release preflight confirms restrictive `object-src`, `base-uri`, `form-action`, `frame-ancestors`, and media CSP directives.
- [ ] During the real production voice call, after enabling `localStorage.setItem("voxperyVoiceDiagnostics", "1")` and reloading, DevTools `window.__VOXPERY_VOICE_DIAGNOSTICS__` reports `rnnoiseStatus: "ready"` and `aggressiveIsolation: true` when suppression is on.
- [ ] Unsent text restores independently after switching between two server channels and two DMs, survives reload/desktop restart for the same user, and is absent for another user on the same device.
- [ ] A successful send clears only that conversation's text draft; a failed send preserves it, and file attachments are never restored as persistent drafts.
- [ ] Desktop idle traffic follows [NETWORK_USAGE_BENCHMARK.md](NETWORK_USAGE_BENCHMARK.md): there is one WebSocket connection and no six-second friend-request polling.
- [ ] `docs/VOICE_SUPPRESSION_SMOKE_TEST.md` completed and recorded as `GO` when suppression, CSP, service workers, build output, or production deployment config changed.
- [ ] Voice join deny/error UX is understandable (no broken or stuck state).

## 5) Final Sign-off

- [ ] Changelog updated (`docs/CHANGELOG.md`).
- [ ] Deployment notes updated if needed (`docs/DEPLOYMENT.md`).
- [ ] Release notes draft prepared.
- [ ] Release notes mention validation scope and any intentionally skipped checks.
- [ ] Previous stable desktop installer artifacts remain available for manual rollback.
- [ ] If the decision is `NO-GO`, rollback or draft-release handling is documented before announcement.
- [ ] Approved to tag and publish.

## Sign-off

- QA / Maintainer:
- Final decision: `GO` / `NO-GO`
- Notes:
