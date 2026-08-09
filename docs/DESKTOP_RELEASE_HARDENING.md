# Desktop Release Hardening

This document defines Voxpery desktop release hardening policy for metadata, deep-link OAuth safety, and signing strategy.

## 1) Metadata and Branding (required)

- `apps/desktop/src-tauri/tauri.conf.json` must keep:
  - `productName = "Voxpery"`
  - `identifier = "com.voxpery"`
  - `bundle.windows.nsis.installerIcon = "icons/icon.ico"`
  - `bundle.icon` includes at least:
    - `icons/icon.ico`
    - `icons/icon.icns`
    - `icons/128x128.png`
- Release pipeline validates icon files and minimum file sizes before build.
- macOS release bundles must merge `Info.plist` usage descriptions for microphone, camera, screen recording, and shared system audio.
- macOS release bundles must apply `Entitlements.plist` with audio-input and camera capture entitlements.
- Until Developer ID signing is configured, macOS release bundles use Tauri's ad-hoc signing identity (`-`) so those entitlements are applied consistently.
- Release preflight validates both files and their Tauri configuration link so native permission registration cannot regress silently.

## 2) OAuth Deep-link Safety (required)

- Desktop OAuth callback origin is `voxpery://auth`.
- Backend CORS allowlist must include `voxpery://auth`.
- Desktop deep-link scheme in Tauri config must include `voxpery`.
- The desktop client must process both cold-start URLs from the deep-link plugin's `getCurrent()` API and runtime URLs from `onOpenUrl`/single-instance events.
- The single-instance plugin must be registered before other desktop plugins, and runtime links received before the webview listener is ready must be drained from the native pending-link queue.
- OAuth callback codes are single-use. Duplicate delivery through multiple desktop event sources must be deduplicated before exchange.
- The responsive browser handoff page must attempt to open Voxpery automatically, keep an accessible explicit user-gesture fallback, safely encode the generated deep-link URL, and use the same branded status UI for success and failure callbacks.
- Release preflight validates:
  - deep-link scheme setup
  - frontend OAuth origin behavior

## 2.1) Release Network Scope (required)

- Release desktop capability scope must allow only Voxpery production network targets.
- `apps/desktop/src-tauri/capabilities/default.json` must not allow `localhost` or `127.0.0.1` HTTP targets in release builds.
- `apps/desktop/src-tauri/tauri.conf.json` CSP `connect-src` must not include local HTTP/WS backends in release builds.
- `apps/desktop/src-tauri/tauri.conf.json` CSP must allow Cloudflare Turnstile on `connect-src`, `script-src`, and `frame-src` so desktop registration can render CAPTCHA when production requires it.
- Release and development CSPs must deny plugin/object content and parent framing, restrict base/form targets, and explicitly allow only self/blob media required by chat and voice playback.
- Release preflight rejects missing `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, or `media-src 'self' blob:` directives.
- If local backend access is needed for development, it must live in a dev-only config and never ship in the default release capability set.
- Voxpery development uses `apps/desktop/src-tauri/tauri.dev.conf.json` together with `cargo tauri dev --config tauri.dev.conf.json` for local backend connectivity.

## 3) Signing Strategy

Current strategy:

- Desktop updater artifacts are enabled (`bundle.createUpdaterArtifacts=true`).
- Updater signing is mandatory for every desktop release build.

Mandatory conditions when updater artifacts are enabled:

- `plugins.updater.pubkey` must be a real key (not placeholder text).
- CI must inject the real updater public key before validation/build.
- Repository secret `TAURI_SIGNING_PRIVATE_KEY` must be configured.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is required if the key is password-protected.
- `plugins.updater.endpoints` must point to the official GitHub `latest.json` release metadata URL.

This policy is enforced in release preflight validation.

## 4) Updater Artifact Verification (required)

Before publishing or announcing a desktop release:

- `latest.json` must be uploaded to the same GitHub Release as the installer artifacts.
- The `latest.json` version must match the Git tag and desktop app version.
- Every updater asset referenced by `latest.json` must have a matching `.sig` file.
- Artifact URLs in `latest.json` must point to release assets for the same version, not draft-only, private, temporary, or older release URLs.
- The updater public key injected into `apps/desktop/src-tauri/tauri.conf.json` must match the private key used to sign the release artifacts.
- Manual `Release / Desktop` workflow runs must target the exact release tag/ref and use `smoke_checklist_confirmed=yes`.
- Production desktop releases should build all supported platforms. Single-platform manual runs are acceptable for test or explicit hotfix scopes only and must be noted in the release checklist.
- If a GitHub Release exists but the desktop workflow did not run or did not attach updater metadata, keep the release as draft until the workflow is rerun against the correct tag/ref.

## 5) Manual QA Gate (required)

Before publishing a desktop release:

1. Complete `docs/RELEASE_SMOKE_TEST_CHECKLIST.md`.
2. Confirm OAuth deep-link roundtrip works from browser back to both a closed and an already-running desktop app.
3. Confirm installer uses Voxpery icon/name (not default NSIS icon).
4. Confirm update check UX:
   - no-update state is understandable
   - available-update state shows version metadata
   - failed update check/install does not crash or leave the settings panel stuck
5. Confirm fresh installs enable `Launch on startup` by default, the user can disable it, and the disabled preference persists.
6. Confirm normal app launch opens maximized on a fresh install, then restores the user's last size, position, and maximized state on later launches.
7. Confirm Windows startup launch stays in the tray until the user opens Voxpery from the tray, and tray Show opens a maximized window.
8. Confirm installer/update preparation closes tray/minimize state cleanly before install.
9. On a clean macOS account, confirm microphone and screen-recording prompts identify Voxpery and the app remains listed in both Privacy & Security sections.
10. Start screen share on macOS and confirm remote voice volume remains stable while the native picker opens, after a source is selected, and while Voxpery is unfocused.

## 6) Rollback Expectations

Voxpery desktop rollback is manual and release-artifact based:

- Keep the previous stable installer artifacts available in GitHub Releases.
- If a desktop release is bad, mark the bad release as draft or remove the updater metadata asset so clients stop discovering it.
- Publish or re-promote the previous stable release metadata if updater clients must move back to a known-good version.
- Document the rollback decision and affected version in release notes or the incident record.

## 7) Recommended Repository Secrets

- `VITE_API_URL` (required for desktop release build)
- `VITE_TURNSTILE_SITE_KEY` (required as a repository variable or secret for desktop release builds)
- `TAURI_UPDATER_PUBLIC_KEY` (required when updater artifacts enabled)
- `TAURI_SIGNING_PRIVATE_KEY` (required only when updater artifacts enabled)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional; required if private key is encrypted)
