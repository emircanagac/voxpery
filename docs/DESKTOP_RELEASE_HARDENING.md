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
- `apps/desktop/src-tauri/tauri.conf.json` CSP must allow Cloudflare Turnstile on `connect-src`, `script-src`, and `frame-src`, and the API origin on `frame-src`, so in-app registration can load `/api/auth/captcha-frame`.
- Release and development CSPs must deny plugin/object content and parent framing, restrict base/form targets, and explicitly allow only self/blob media required by chat and voice playback.
- Release preflight rejects missing `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, or `media-src 'self' blob:` directives.
- If local backend access is needed for development, it must live in a dev-only config and never ship in the default release capability set.
- Voxpery development uses `apps/desktop/src-tauri/tauri.dev.conf.json` together with `cargo tauri dev --config tauri.dev.conf.json` for local backend connectivity.
- Capabilities:
  - `tauri.conf.json` enables only the `default` capability (`app.security.capabilities: ["default"]`), so the release `gen/schemas/capabilities.json` contains only `default`.
  - The development capability (`dev-local-api`, HTTP access to the local backend) is inlined in `tauri.dev.conf.json`. No file in `capabilities/` may grant loopback targets or remote origins.
  - `validate-security-policies.mjs` enforces all three rules.
  - `default` is a local capability: the bundled app is served from the runtime's own scheme URL (`https://tauri.localhost` on Windows and Linux CEF, `tauri://localhost` on macOS), and Tauri treats that origin as local. In development, the `devUrl` counts as local.
  - The app's own commands (`desktop_*`) are listed in `build.rs` (`AppManifest::commands`), so Tauri checks them against capabilities like plugin commands. `default` grants each one with an `allow-*` permission. Pages from other origins inside the window, such as a server's captcha frame, have no capability and are refused; `ipc_access_tests` in `src/main.rs` covers this. A new command must be added to both `build.rs` and `default.json`, or the app refuses it.
  - Check on each platform that sign-in, keyring persistence, the updater and HTTP requests work in an installed release build.

## 2.1.0) Desktop Platform Decision

Decision (October 2026): keep one desktop app on Tauri 3 alpha for Windows, macOS and Linux, with every Tauri crate pinned to an exact version.

- Why Tauri 3 alpha: Linux needs WebRTC for voice, and system WebKitGTK builds ship without it. Chromium through `tauri-runtime-cef` exists only in Tauri 3. Windows and macOS stay on their system webviews through `tauri-runtime-wry`.
- Considered: Tauri 2 stable for Windows and macOS with Tauri 3 only on Linux. Rejected for now: one crate cannot depend on two Tauri major versions without duplicating the app shell, plugins, capability schemas and release pipeline per platform, which doubles maintenance and the manual QA gate. Windows and macOS have run on Tauri 3 alpha since the Linux CEF move (#409) without platform-specific regressions.
- Revisit when any of these happens:
  - Tauri 3 reaches beta or stable: move all crates and JS packages together.
  - An alpha regression on Windows or macOS has no workaround: re-evaluate a split.
  - WebKitGTK ships WebRTC in the supported distributions: re-evaluate CEF on Linux.
- Upgrade policy: upgrade `tauri`, `tauri-build`, the runtimes and all plugins in one change. Run the full manual QA gate (section 5) on all three platforms before release, and the Linux checks in 2.1.1.
- JavaScript packages: the web app uses `@tauri-apps/api` and plugin packages 2.x, while the Rust crates are 3.0.0 alphas, and 3.0.0 alpha JS packages exist on npm. The JS packages only wrap IPC calls, and every call the app makes has worked unchanged on all three platforms since v0.4.0:
  - `core` invoke, `window`, `event`, `app` version
  - the HTTP plugin fetch, updater check and install, process relaunch
  - deep-link URLs, global shortcuts, autostart, opener
  - the app's own `desktop_*` and `secure-storage` commands

  Section 5 exercises each of these. Move the JS packages to 3.x together with the next Tauri crate upgrade and verify the same list. A plugin whose command changes would otherwise fail only at runtime.
- Upstream issues tracked:
  - tauri-apps/tauri#16251: the Linux CEF webview loses X11 keyboard focus; worked around by `src/linux_focus.rs`, see 2.1.1.
  - The `glib` 0.18 advisory (#242): `glib` 0.18 comes in through `gtk` 0.18, which Tauri's menu crate `muda` 0.20 uses. It needs an upstream move to newer gtk-rs crates and stays documented until then.

## 2.1.1) Linux Tauri Runtime And Packaging

- The desktop app is on Tauri 3 (alpha, versions pinned exactly). Windows and macOS keep the system webview through `tauri-runtime-wry`; Linux uses Chromium through `tauri-runtime-cef`, because system WebKitGTK builds ship without WebRTC (disabled in 2.54). The Tauri 3 CLI selects the runtime per target, so only Linux packages ship CEF.
- Linux packages bundle the CEF distribution (the .deb is about 150 MB, about 340 MB installed) and require GTK 4.14+ (Ubuntu 24.04 or newer, current Fedora). They no longer depend on WebKitGTK. The first build downloads CEF (~1 GB) into `~/.cache/tauri-cef`; CI caches it.
- On Linux, `Builder::on_permission_request` allows microphone and camera. CEF runs this handler on its UI thread, so it must not call blocking webview getters such as `url()` (that deadlocks the app on the first `getUserMedia`). The main window only loads the app's own origin, and Chromium's default permissions policy denies these capabilities to cross-origin frames.
- On the CEF runtime, blocking window/webview getters (`is_focused`, `url`, sizes, positions) deadlock when called on the main thread outside the event loop, which includes synchronous IPC commands and CEF callbacks. Desktop commands that read window or webview state must be `async` (they then run on a worker thread). Verify `RTCPeerConnection` plus `addTrack`/`addTransceiver` inside the installed app, not only microphone capture in another browser.
- Deep links reach a running instance in two ways: on Windows the single-instance plugin forwards the second launch's arguments; on Linux (CEF) and macOS the runtime delivers them as `RunEvent::Opened`, which the deep-link plugin forwards to the webview. `main.rs` brings the main window forward for `Opened` as well, so OAuth and registration returns surface the app on every platform. If the browser cannot open the app at all, the handoff page shows the one-time code for "Use a sign-in code" on the login and sign-up screens.
- On Linux the CEF browser is a foreign X11 child of the GTK window, and after the window is shown or reactivated X11 keyboard focus can stay on GTK's focus proxy: clicks focus page inputs but no key events arrive (tauri-apps/tauri#16251). `src/linux_focus.rs` handles the main window's `Focused(true)` event by giving the browser CEF focus and X11 input focus through `with_webview`, which queues the work on CEF's UI thread. A click inside the already focused window can also move X11 focus back to GTK without a new focus event, so on Linux desktop the web app calls `desktop_refocus_webview_keyboard` after every `pointerup`; that command refocuses the browser right away and once more 150 ms later, and only when X11 focus is still inside Voxpery's own window, so it never takes focus from another application. Remove both once the runtime fixes focus; verify typing after startup, tray restore, switching windows, and clicking elsewhere in the app and then back into a text field (X11 and Wayland/XWayland).
- Session storage uses the in-app `secure-storage` plugin (`src/secure_storage.rs`, keyring 3) with the same plugin name, commands and keyring entries (service = product name, account = prefixed key) as the former `tauri-plugin-secure-storage`, so existing desktop sessions survive the upgrade.
- GTK application ID is `com.voxpery`. Both .deb and .rpm install `com.voxpery.desktop`, with `Exec=voxpery-desktop %U`, `Icon=voxpery-desktop`, and the `voxpery` scheme handler. `com.voxpery.desktop` is the only `voxpery://` handler. The bundler still writes `Voxpery.desktop` from `linux/legacy.desktop.hbs`; it is hidden (`NoDisplay=true`) and registers no scheme, so browsers never ask which of two "Voxpery" entries should open a sign-in return.
- The Linux tray uses Tauri 3's `ksni` backend (StatusNotifierItem over D-Bus), not libappindicator; GNOME still needs its AppIndicator extension to show it. The .deb declares `libgtk-4-1` and the .rpm `gtk4` in `tauri.conf.json`, in addition to what the Tauri CLI adds.
- The CSP allows `ipc:`, `http://ipc.localhost` and `https://ipc.localhost`: with `useHttpsScheme`, Windows and the Linux CEF build use the HTTPS IPC origin (`https://tauri.localhost` app origin). If the IPC fetch is blocked, Tauri falls back to `postMessage`, so a missing origin degrades silently instead of failing. Install using the target package manager; extracting a Debian binary on Arch does not install dependencies or register a launcher/handler.
- Preflight checks launcher content and GTK identity with `validate-linux-launchers.mjs`; this is not installed-package or distro compatibility acceptance. Verify actual artifact contents, `xdg-mime query default x-scheme-handler/voxpery`, menu/taskbar icons, and OAuth delivery to cold/running apps on the target desktop.
- Linux close-to-background and autostart minimize the window instead of hiding it, retaining a taskbar recovery path when the tray host is absent or broken. This fallback does not resolve the reported blank GNOME tray menu. Show/Quit still require native GNOME/KDE verification.
- Each release attaches `Voxpery_<version>_x86_64.flatpak` next to the .deb and .rpm. It is not a Flathub build: the `flatpak` job in `release-desktop.yml` repackages the release .deb inside `ghcr.io/flathub-infra/flatpak-github-actions:gnome-51` (manifest, launcher, desktop file, metainfo and `prepare-build-dir.sh` are in `apps/desktop/src-tauri/linux/flatpak`), checks that the bundled metainfo carries the release version, and `publish-flatpak` uploads it to the release with `gh release upload`. A tag build fails if the tag and the built version differ.
- The Flatpak app ID is `com.voxpery.Voxpery` (three components, the Flatpak convention); .deb and .rpm keep `com.voxpery`. Runtime `org.gnome.Platform` 51 provides GTK 4; base `org.electronjs.Electron2.BaseApp` 26.08 provides zypak. The launcher starts the app through `zypak-wrapper`, so CEF's sandboxed helper processes run in the Flatpak sandbox. The setuid `chrome-sandbox` from the .deb is removed (setuid has no effect in a Flatpak) and the Chromium sandbox is never turned off.
- Permissions and why: `--share=network` (API, WebSocket, LiveKit media); `--share=ipc` and `--socket=x11` (the CEF runtime always renders through X11, XWayland on Wayland sessions); `--socket=pulseaudio` (microphone and playback); `--device=all` (Chromium opens `/dev/video*` for the camera and uses the GPU; Flatpak has no narrower camera device permission); `--talk-name=org.freedesktop.secrets` (sign-in session in the Secret Service keyring); `--talk-name=org.freedesktop.Notifications` (message notifications); `--talk-name=org.kde.StatusNotifierWatcher` (tray host). No filesystem access: file dialogs go through the portal.
- The tray library owns a `org.kde.StatusNotifierItem-<pid>-<id>` D-Bus name, which a Flatpak could only allow with a broad `--own-name=org.kde.*`; that is not granted, so the tray icon may be missing in the Flatpak. Startup already tolerates a missing tray, and Linux close-to-background minimizes the window instead of hiding it.
- Updates: the in-app updater stays off in a Flatpak (`desktop_update_channel` reports `flatpak` when `FLATPAK_ID` is set or `/.flatpak-info` exists, and `apps/web/src/updater.ts` skips checks and installs). Settings > Desktop says to install the newer `.flatpak` and opens the releases page. Install or update with `flatpak install --user --reinstall ./Voxpery_<version>_x86_64.flatpak`; the first install also fetches the GNOME runtime from Flathub. Data under `~/.var/app/com.voxpery.Voxpery` and the keyring session are kept across reinstalls. Launch on startup is not offered in a Flatpak: the autostart plugin would write its entry inside the sandbox, where the session never reads it.
- Verify on a clean Linux system, recording Wayland and X11 sessions separately: install from the file, first start, update with the next version's file and keep the signed-in session and settings, the CEF sandbox in use (no `--no-sandbox` in the process list), Google sign-in returning through `voxpery://`, session after restart, microphone, camera and screen sharing, notifications and the tray.
- Linux startup also tolerates tray construction failure and retains the main window/taskbar. Absence of a StatusNotifier host must not prevent login or voice; other platforms retain their existing tray initialization behavior.
- Production Linux uses `tauri://localhost`. Turnstile requires HTTP/HTTPS, and `useHttpsScheme` does not change this Linux origin. Desktop email registration runs in the app: the form is the same as on the web and Turnstile runs in the API-hosted `/api/auth/captcha-frame`, which posts only the token to the app origin. Older builds hand off to `/api/auth/desktop-registration` in the browser, where the server-hosted widget is verified by Siteverify and the app receives only a short-lived PKCE-bound code. CAPTCHA success on local HTTP or with test keys does not close the production registration issue; validate the real authorized HTTPS origin and keep desktop IPC restrictions intact.
- Do not claim all-distribution voice support until maintained runtime support and installed-package two-user voice/screenshare pass the support matrix. WebKitGTK [2.54 release notes](https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html) explicitly describe the WebRTC transition/disabled feature; an earlier package's API absence still requires its own runtime/build diagnosis. Downgrading to an unmaintained build or disabling the sandbox is not a release solution.

## 2.1.2) Window Title Bar

- The main window has no system title bar on any platform (`decorations: false`, `shadow: true` in `tauri.conf.json`). The app header (`.shell-topbar` in `AppShell`) is the title bar everywhere: brand on the left, Quick Search centered, and `WindowControls` (minimize, maximize/restore, close) on the right. The header is a `data-tauri-drag-region="deep"` area; its buttons stay clickable, and double-clicking an empty part maximizes or restores the window.
- Screens without the app header (sign-in, loading, legal pages) get `DesktopWindowChrome`: a 36px draggable strip with the same window buttons, hidden as soon as the app header is shown. On Linux it also adds thin resize borders, because the CEF runtime gives a frameless window no system borders; Windows and macOS keep their native resize borders and window shadow.
- The close button sends the normal close request, so "Keep running in tray on close" still applies. The capability grants only the window commands this needs: `start-dragging`, `internal-toggle-maximize`, `minimize`, `toggle-maximize`, `close` and `start-resize-dragging`.
- Verify on each platform: drag from the header and the sign-in strip, double-click to maximize and restore, edge resizing (Linux on GNOME and KDE, X11 and Wayland), minimize/maximize/close, close-to-tray, and Windows snapping by dragging to screen edges (the Windows 11 snap layouts flyout on the maximize button is not available with custom buttons).

## 2.1.3) Custom Server (Self-Hosted Backends)

The desktop app connects to voxpery.com by default. A self-hosted Voxpery server can be chosen under "Advanced: custom server" on the sign-in screen or in Settings. Most users never see it.

Design (the security model, enforced in Rust):

- **Address:**
  - The user enters the server address. Only an origin is accepted: no path, query, credentials or fragment.
  - `https` is required. `http` is accepted only for `localhost`, loopback, private IPv4 (10/8, 172.16/12, 192.168/16), unique-local or link-local IPv6, and `.local` names, and the UI shows a warning.
- **Probe:** before anything is stored, the desktop process itself (not the webview) fetches `<origin>/api/system/features`:
  - redirects off, 8-second timeout, 64 KB limit;
  - the response must be a Voxpery feature object.
  - Its `voice_url` (`LIVEKIT_WS_URL`) gives the voice origin, which must follow the same scheme rules.
- **Website addresses:** when the address is not a Voxpery API, the app reads `<origin>/.well-known/voxpery/client` (`{"api_base_url": "..."}`, served by the web image from `VITE_API_URL`) with the same limits. The named API must pass the address rules, may not drop from `https` to `http`, and is then probed like a typed API. The trust prompt shows both the website and the API origin, and only the API origin is stored.
- **Consent:** the user must tick that they trust the server. The confirming command probes the server again, so the webview cannot store an address that was not checked.
- **Storage:** the choice is stored in `custom-server.json` in the app configuration directory. It survives updates, and the updater keeps using the official release feed.
- **Applying the choice (on restart):**
  - The HTTP plugin gets a runtime capability for that origin only.
  - The main window's CSP adds the API and voice origins to `connect-src`, and the API origin to `frame-src` and `img-src`.
  - The web app reads the API base from an initialization script.
  - "Use voxpery.com" removes the file and restarts.
- **Sessions:** the keyring account for each stored item includes the active server (`voxpery-auth-token@https://chat.example.org`).
  - Rust chooses the account, and the plugin accepts only the app's two known keys.
  - The webview therefore can never read or send another server's token.
- **Build-time alternative:** `VITE_API_URL` and the release CSP can still be changed for a custom build, but such a build is replaced by the official one on its first update. The setting above is the supported way.
- **Verify on Windows, macOS and Linux, each with voxpery.com, a custom `https` server and `http://localhost`:**
  - sign in with email and with Google;
  - the session persists after a restart;
  - switching back keeps the other server's session separate;
  - messages, WebSocket, voice and screen sharing, and attachments work;
  - the updater works and keeps the setting.

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
