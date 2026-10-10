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
- Releases ship one installer per operating system: Windows NSIS `setup.exe` (no MSI; the artifact validator rejects one), a macOS universal `.dmg` built with `--target universal-apple-darwin` for Intel and Apple Silicon, and the Linux packages. The updater manifest `latest.json`, the macOS `.app.tar.gz` update bundle and the `.sig` signatures are update metadata, not installers, and must stay published. Existing MSI installs receive the NSIS installer as their update; it installs per user, so those users should uninstall the MSI copy.
- Every desktop, mobile and web icon is generated from the master logo `apps/web/public/voxpery-logo.svg` (the two-tone fox mask, with no background) by `node scripts/brand/generate-icons.mjs`. Each PNG, ICO frame (16/20/24/32/40/48/64/256 px) and ICNS entry is rendered from the vector at its exact pixel size, not downsampled from a large bitmap. The ICO 32 px frame is byte-identical to `32x32.png`, which also serves the default small window icon. The runtime tray uses `icons/tray.png` (64 px) and draws the unread dot on top. Windows, Linux, the tray, the favicon, PWA "any" icons and in-app logos use the bare fox; macOS uses the bare fox on the padded macOS grid. Only platforms that require an opaque icon get the dark navy background (`#1B2130`): iOS and `apple-touch-icon.png` (opaque square), Android launchers and adaptive background, and the PWA maskable icon. Change the logo only in the master SVG and rerun the script.
- Rebuild those assets with `node .github/scripts/generate-desktop-small-icons.mjs --sharp-module <absolute-path-to-installed-sharp>`. Add `--check` to verify the generated files without rewriting them. Sharp is an optional asset-generation tool, not an application/runtime dependency. Regeneration preserves large ICO payloads and is deterministic for the same Sharp version. Validate normal/unread icons on light/dark Windows taskbars at 100%, 125%, 150% and 200% scaling; Windows may retain pinned-icon caches until the updated application is restarted or repinned.
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

## 2.1.1) Linux Tauri Runtime And Packaging

- The desktop app is on Tauri 3 (alpha, versions pinned exactly). Windows and macOS keep the system webview through `tauri-runtime-wry`; Linux uses Chromium through `tauri-runtime-cef`, because system WebKitGTK builds ship without WebRTC (disabled in 2.54). The Tauri 3 CLI selects the runtime per target, so only Linux packages ship CEF.
- Linux packages bundle the CEF distribution (the .deb is about 150 MB, about 340 MB installed) and require GTK 4.14+ (Ubuntu 24.04 or newer, current Fedora). They no longer depend on WebKitGTK. The first build downloads CEF (~1 GB) into `~/.cache/tauri-cef`; CI caches it.
- On Linux, `Builder::on_permission_request` allows microphone and camera. CEF runs this handler on its UI thread, so it must not call blocking webview getters such as `url()` (that deadlocks the app on the first `getUserMedia`). The main window only loads the app's own origin, and Chromium's default permissions policy denies these capabilities to cross-origin frames.
- On the CEF runtime, blocking window/webview getters (`is_focused`, `url`, sizes, positions) deadlock when called on the main thread outside the event loop, which includes synchronous IPC commands and CEF callbacks. Desktop commands that read window or webview state must be `async` (they then run on a worker thread). Verify `RTCPeerConnection` plus `addTrack`/`addTransceiver` inside the installed app, not only microphone capture in another browser.
- Session storage uses the in-app `secure-storage` plugin (`src/secure_storage.rs`, keyring 3) with the same plugin name, commands and keyring entries (service = product name, account = prefixed key) as the former `tauri-plugin-secure-storage`, so existing desktop sessions survive the upgrade.
- GTK application ID is `com.voxpery`. Both .deb and .rpm install `com.voxpery.desktop`, with `Exec=voxpery-desktop %U`, `Icon=voxpery-desktop`, and the `voxpery` scheme handler. The generated `Voxpery.desktop` remains a hidden compatibility launcher so old handler selections continue to pass OAuth URLs without a duplicate menu entry.
- The Linux tray uses Tauri 3's `ksni` backend (StatusNotifierItem over D-Bus), not libappindicator; GNOME still needs its AppIndicator extension to show it. The .deb declares `libgtk-4-1` and the .rpm `gtk4` in `tauri.conf.json`, in addition to what the Tauri CLI adds.
- The CSP allows `ipc:`, `http://ipc.localhost` and `https://ipc.localhost`: with `useHttpsScheme`, Windows and the Linux CEF build use the HTTPS IPC origin (`https://tauri.localhost` app origin). If the IPC fetch is blocked, Tauri falls back to `postMessage`, so a missing origin degrades silently instead of failing. Install using the target package manager; extracting a Debian binary on Arch does not install dependencies or register a launcher/handler.
- Preflight checks launcher content and GTK identity with `validate-linux-launchers.mjs`; this is not installed-package or distro compatibility acceptance. Verify actual artifact contents, `xdg-mime query default x-scheme-handler/voxpery`, menu/taskbar icons, and OAuth delivery to cold/running apps on the target desktop.
- Linux close-to-background and autostart minimize the window instead of hiding it, retaining a taskbar recovery path when the tray host is absent or broken. This fallback does not resolve the reported blank GNOME tray menu. Show/Quit still require native GNOME/KDE verification.
- Flatpak installs are updated by Flathub, not by the in-app updater (the Flatpak `/app` tree is read-only). The `desktop_update_channel` command reports `flatpak` when `FLATPAK_ID` is set or `/.flatpak-info` exists, and `apps/web/src/updater.ts` then skips update checks and installs; Settings > Desktop says updates come from Flathub. A Flatpak package repackages the released `.deb`; it needs no separate app build.
- Linux startup also tolerates tray construction failure and retains the main window/taskbar. Absence of a StatusNotifier host must not prevent login or voice; other platforms retain their existing tray initialization behavior.
- Production Linux uses `tauri://localhost`. Turnstile requires HTTP/HTTPS, and `useHttpsScheme` does not change this Linux origin. Desktop email registration now hands off to `/api/auth/desktop-registration` in the browser, where the server-hosted widget is verified by Siteverify and the app receives only a short-lived PKCE-bound code. CAPTCHA success on local HTTP or with test keys does not close the production registration issue; validate the real authorized HTTPS origin and keep desktop IPC restrictions intact.
- Do not claim all-distribution voice support until maintained runtime support and installed-package two-user voice/screenshare pass the support matrix. WebKitGTK [2.54 release notes](https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html) explicitly describe the WebRTC transition/disabled feature; an earlier package's API absence still requires its own runtime/build diagnosis. Downgrading to an unmaintained build or disabling the sandbox is not a release solution.

## 2.2) Microphone Shortcut Validation

- Toggle microphone mute accepts bare physical letter/digit keys and F1-F24; supported space/arrow/punctuation codes require a modifier. Modifier-only keys, Escape, mouse buttons, numpad and unsupported special keys are not assigned. Escape cancels recording. Keyboard layout labels may differ from the stored physical key code.
- The desktop global-shortcut plugin registers the chosen binding before it is stored. Registration failure preserves the previous binding/preference and displays an error. Capture ignores repeated keys and serializes pending saves; capture itself cannot toggle mute. Clear unregisters the active binding and removes its preference.
- The binding calls the existing voice mute action only in an active session, with existing server mute/deafen and push-to-talk conflict guards. Desktop registration works while the application runs, including minimized/tray mode, subject to OS-reserved or occupied shortcuts; web fallback is limited to the focused Voxpery tab and does not fire while typing.
- Unit/mocked-runtime tests do not prove native system-wide delivery. Before release, assign, rebind and clear on Windows while focused, unfocused and minimized, restart with a saved binding, test an occupied shortcut and a push-to-talk conflict, and verify exactly one mute toggle per physical key press.

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
- `VITE_GIPHY_API_KEY` (optional repository variable for live GIF search and trending results)
- `TAURI_UPDATER_PUBLIC_KEY` (required when updater artifacts enabled)
- `TAURI_SIGNING_PRIVATE_KEY` (required only when updater artifacts enabled)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional; required if private key is encrypted)
