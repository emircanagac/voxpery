# Release Smoke Test Checklist

Use this checklist for every production release candidate before tag/publish.

For releases that touch voice, WebRTC, LiveKit, service workers, build output, or audio settings, also complete `docs/VOICE_SUPPRESSION_SMOKE_TEST.md`.

## Release Candidate Info

- Version:
- Commit SHA:
- Tester:
- Date (UTC):
- Environment:

## 1) Required PR Gates (must be green)

- [ ] `Checks / Secret Scan`
- [ ] `Checks / Backend`
- [ ] `Checks / Frontend` (lint, unit tests, build)

## 2) Security and Release Gates (mandatory)

- [ ] Relevant `CodeQL` analyzers are green or did not run because no matching files changed.
- [ ] `Dependency Security Audit` is reviewed; unresolved upstream-blocked advisories have an explicit release decision recorded.
- [ ] Remote avatar/server icon/inline media proxy rejects localhost/private targets and still loads normal public HTTPS images.
- [ ] Manual `Release Smoke` workflow completed successfully against the release candidate API.
- [ ] `Release Smoke` ran with strict security headers enabled for production candidates.

## 3) Web Smoke Tests (mandatory)

- [ ] Register works.
- [ ] Login works.
- [ ] Password reset request + reset flow works.
- [ ] Google OAuth login works.
- [ ] Server/channel/category permission scenarios work.
- [ ] Voice join/leave works.
- [ ] Camera self-preview recovers after switching from an active voice channel to another chat, DM, or server and then returning, while the remote user keeps seeing the camera feed.
- [ ] Remote camera and screen-share tiles can be hidden and shown again without leaving voice; hiding a screen share also mutes only the screen-share audio while normal microphone audio continues.
- [ ] Moderation flows (kick/ban/timeout/clear-timeout) work.
- [ ] Timed-out members cannot send/edit server-channel messages or add new reactions until cleared or expired.
- [ ] Mobile server chat shows one visible message after send, including after the API response and WebSocket echo both arrive.
- [ ] Mobile Social/Friends list scrolls when the visible friend or request list exceeds the viewport.
- [ ] Safety moderation view shows open reports, active timeouts, and recent raid events.
- [ ] Server Settings opens and remains scrollable on desktop; mobile still shows the desktop-only guidance instead of a broken settings modal.
- [ ] AutoMod rule create/edit/enable/disable/delete works and blocked messages do not persist or broadcast.
- [ ] Raid protection records message bursts, invite spikes, and join burst signals in audit/moderation activity without exposing private secrets.
- [ ] Category overrides work for `View Channel`, `Send Messages`, `Connect to Voice`.
- [ ] Unread badges, per-channel mute, server mention notifications, DM notifications, and friend request notifications behave correctly across refresh, PWA, and desktop.
- [ ] Web app is installable as a PWA and the service worker does not cache API, auth, WebSocket, or navigation responses.
- [ ] Production voice call with noise suppression on does not reuse a stale cached RNNoise worklet after deploy.

## 4) Desktop Smoke Tests (mandatory)

- [ ] Installer opens with Voxpery app name and icon (not default NSIS icon).
- [ ] App opens maximized by default and reaches login screen.
- [ ] After resize/unmaximize and restart, the desktop app restores the user's last size, position, and maximized state.
- [ ] Fresh desktop install enables `Launch on startup` by default, and disabling it from settings persists across restart.
- [ ] Windows startup launch keeps Voxpery in the background/tray, and opening it from the tray shows a maximized window.
- [ ] Production desktop build connects only to the official API and does not allow localhost API scopes.
- [ ] Desktop register screen renders CAPTCHA and new account registration succeeds when production CAPTCHA is enabled.
- [ ] Google OAuth opens browser and returns to desktop app via `voxpery://` deep link.
- [ ] Session is restored after OAuth callback (user ends in authenticated app state).
- [ ] If updater artifacts are enabled, signing keys and updater pubkey are configured (see `docs/DESKTOP_RELEASE_HARDENING.md`).
- [ ] Updater check shows a clear no-update state when no newer version is available.
- [ ] Updater check shows the available version when a newer signed release is available.
- [ ] Update availability appears as one calm toast plus a compact install pill; settings still provides manual check/install.
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
- [ ] During the real production voice call, after enabling `localStorage.setItem("voxperyVoiceDiagnostics", "1")` and reloading, DevTools `window.__VOXPERY_VOICE_DIAGNOSTICS__` reports `rnnoiseStatus: "ready"` and `aggressiveIsolation: true` when suppression is on.
- [ ] `docs/VOICE_SUPPRESSION_SMOKE_TEST.md` completed and recorded as `GO` for voice behavior.
- [ ] Voice join deny/error UX is understandable (no broken or stuck state).

## 5) Final Sign-off

- [ ] Changelog updated (`docs/CHANGELOG.md`).
- [ ] Deployment notes updated if needed (`docs/DEPLOYMENT.md`).
- [ ] Release notes draft prepared.
- [ ] Previous stable desktop installer artifacts remain available for manual rollback.
- [ ] Approved to tag and publish.

## Sign-off

- QA / Maintainer:
- Final decision: `GO` / `NO-GO`
- Notes:
