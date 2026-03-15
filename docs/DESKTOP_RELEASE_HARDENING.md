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

## 3) Signing Strategy

Current strategy:

- Regular installer releases are allowed without updater artifacts.
- If updater artifacts are enabled (`bundle.createUpdaterArtifacts=true`), signing becomes mandatory.

Mandatory conditions when updater artifacts are enabled:

- `plugins.updater.pubkey` must be a real key (not placeholder text).
- Repository secret `TAURI_SIGNING_PRIVATE_KEY` must be configured.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is required if the key is password-protected.

This policy is enforced in release preflight validation.

## 4) Manual QA Gate (required)

Before publishing a desktop release:

1. Complete `docs/RELEASE_SMOKE_TEST_CHECKLIST.md`.
2. Confirm OAuth deep-link roundtrip works from browser back to desktop app.
3. Confirm installer uses Voxpery icon/name (not default NSIS icon).

## 5) Recommended Repository Secrets

- `VITE_API_URL` (required for desktop release build)
- `TAURI_SIGNING_PRIVATE_KEY` (required only when updater artifacts enabled)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional; required if private key is encrypted)
