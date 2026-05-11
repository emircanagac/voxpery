# Release Smoke Test Checklist

Use this checklist for every production release candidate before tag/publish.

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
- [ ] Moderation flows (kick/ban/timeout/clear-timeout) work.
- [ ] Timed-out members cannot send/edit server-channel messages or add new reactions until cleared or expired.
- [ ] Safety moderation view shows open reports, active timeouts, and recent raid events.
- [ ] AutoMod rule create/enable/disable/delete works and blocked messages do not persist or broadcast.
- [ ] Raid protection records message bursts, invite spikes, and join burst signals in audit/moderation activity without exposing private secrets.
- [ ] Category overrides work for `View Channel`, `Send Messages`, `Connect to Voice`.
- [ ] Unread badges, per-channel mute, server mention notifications, DM notifications, and friend request notifications behave correctly across refresh, PWA, and desktop.
- [ ] Web app is installable as a PWA and the service worker does not cache API, auth, WebSocket, or navigation responses.

## 4) Desktop Smoke Tests (mandatory)

- [ ] Installer opens with Voxpery app name and icon (not default NSIS icon).
- [ ] App opens and reaches login screen.
- [ ] Production desktop build connects only to the official API and does not allow localhost API scopes.
- [ ] Desktop register screen renders CAPTCHA and new account registration succeeds when production CAPTCHA is enabled.
- [ ] Google OAuth opens browser and returns to desktop app via `voxpery://` deep link.
- [ ] Session is restored after OAuth callback (user ends in authenticated app state).
- [ ] If updater artifacts are enabled, signing keys and updater pubkey are configured (see `docs/DESKTOP_RELEASE_HARDENING.md`).
- [ ] Updater check shows a clear no-update state when no newer version is available.
- [ ] Updater check shows the available version when a newer signed release is available.
- [ ] Updater install path prepares the desktop runtime before install/relaunch.
- [ ] Failed updater check/install shows recoverable UI and does not leave settings stuck.
- [ ] Linux desktop test host has `xdg-desktop-portal` + (`xdg-desktop-portal-gtk` or `xdg-desktop-portal-kde`) and `pipewire` running.
- [ ] First voice join shows OS/browser microphone permission prompt when needed.
- [ ] Voice join succeeds after permission grant.
- [ ] Denying desktop microphone permission shows recovery guidance, opens OS privacy settings from Voice & Audio, and succeeds after permission is restored and retried.
- [ ] Denying desktop camera permission shows OS-specific recovery guidance, opens OS privacy settings when supported, and succeeds after permission is restored and retried.
- [ ] Voice settings mic test with noise suppression on and `Noisy room` selected does not pass normal keyboard, mouse, fan, or breath noise as speech.
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
