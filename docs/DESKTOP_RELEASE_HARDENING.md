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

## 2) OAuth Deep-link Safety (required)

- Desktop OAuth callback origin is `voxpery://auth`.
- Backend CORS allowlist must include `voxpery://auth`.
- Desktop deep-link scheme in Tauri config must include `voxpery`.
- Release preflight validates:
  - deep-link scheme setup
  - frontend OAuth origin behavior

## 2.1) Release Network Scope (required)

- Release desktop capability scope must allow only Voxpery production network targets.
- `apps/desktop/src-tauri/capabilities/default.json` must not allow `localhost` or `127.0.0.1` HTTP targets in release builds.
- `apps/desktop/src-tauri/tauri.conf.json` CSP `connect-src` must not include local HTTP/WS backends in release builds.
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

## 4) Manual QA Gate (required)

Before publishing a desktop release:

1. Complete `docs/RELEASE_SMOKE_TEST_CHECKLIST.md`.
2. Confirm OAuth deep-link roundtrip works from browser back to desktop app.
3. Confirm installer uses Voxpery icon/name (not default NSIS icon).
4. Confirm update check UX:
   - no-update state is understandable
   - available-update state shows version metadata
   - failed update check/install does not crash or leave the settings panel stuck
5. Confirm installer/update preparation closes tray/minimize state cleanly before install.

## 5) Rollback Expectations

Voxpery desktop rollback is manual and release-artifact based:

- Keep the previous stable installer artifacts available in GitHub Releases.
- If a desktop release is bad, mark the bad release as draft or remove the updater metadata asset so clients stop discovering it.
- Publish or re-promote the previous stable release metadata if updater clients must move back to a known-good version.
- Document the rollback decision and affected version in release notes or the incident record.

## 6) Recommended Repository Secrets

- `VITE_API_URL` (required for desktop release build)
- `TAURI_UPDATER_PUBLIC_KEY` (required when updater artifacts enabled)
- `TAURI_SIGNING_PRIVATE_KEY` (required only when updater artifacts enabled)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional; required if private key is encrypted)
