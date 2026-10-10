# Release Smoke Test Checklist

## v0.3.1 Auth And Media Fixes

- [ ] Test browser and installed desktop client pairs against the same candidate revision. Verify restored sessions, bidirectional audible voice, screen/system audio and reconnect. Repeat input/single-instance and keyring/error recovery on the final package; earlier candidate results are not release sign-off.
- [ ] Confirm the production server `.env` contains the public `TURNSTILE_SITE_KEY` (or `VITE_TURNSTILE_SITE_KEY`) alongside `TURNSTILE_SECRET_KEY`; otherwise desktop browser registration refuses to start.
- [ ] Block the Cloudflare script: registration must show an error and Retry, not a blank area or enabled submit. Restore the connection and retry, then verify challenge expiry clears the token and Siteverify rejects absent/invalid responses.

- [ ] Install actual .deb/.rpm on clean GNOME/KDE Wayland/X11 targets. Inspect package runtime dependencies and both launchers; verify `com.voxpery` GTK ID, menu/taskbar/tray icons, scheme registration and Google callback to closed/running apps. Extracted-binary tests do not count as installation acceptance. Run `node --test .github/scripts/validate-linux-launchers.test.mjs` as a supplementary preflight regression.
- [ ] In the installed Linux app, verify WebRTC settings precede the first app document and required RTC APIs exist; two users must join and exchange microphone/screen media after permission approval. Test tray Show/Quit and close/autostart recovery through the taskbar with/without a tray host. A successful native compile does not close unsupported runtime or blank-menu reports.
- [ ] Complete production-key CAPTCHA on the packaged Linux browser handoff, including retry/expiry. The app must open `/api/auth/desktop-registration`, return through `voxpery://auth` with a one-time PKCE code, and never put a JWT or CAPTCHA token in the URL. `tauri://localhost` remains unsuitable for rendering Turnstile directly.
- [ ] In the browser registration form, submit a taken username, an invalid email and mismatched passwords: each must re-render the same form with an error, keep the username/email and legal selections, never echo a password, and still complete with corrected values.
- [ ] Reproduce shared game/music audio with diagnostics enabled on sender/viewer. Compare 500 ms interval energy, screen-only receiver loss/jitter/concealment, actual capture processing, and playback state across mic on/off and speaking/silent system/tab cases. Record whether dips persist; diagnostics/capture constraints alone are not a fix acceptance.

- [ ] At 320x568, 390x844, 960x600, and desktop sizes, Sign Up fields, CAPTCHA, both legal acknowledgements, and actions remain reachable without horizontal overflow. Both signup buttons stay disabled until acknowledgements load and are checked; Google does not require email/password fields or an email-signup CAPTCHA token.
- [ ] Start Google from Login and Sign Up with new and existing accounts on web and desktop. A new account without current acknowledgements reaches registration completion, records actual acceptance once, and returns to its intended route. Verify expired/replayed completion and PKCE code rejection; do not put secrets in screenshots/logs.
- [ ] Simulate metadata/save failure and a document/account change during a pending request. Retry retains valid selections but never unlocks stale account state; current accounts are not asked again.
- [ ] Hard-refresh an accepted account three times: each startup sends one `/api/auth/session` request, no separate `/me` or `/legal-consent` check, and no document-check loading screen. Missing/stale consent still blocks app data; a later server consent signal refreshes it. Test expired cookie, session outage/retry, stored profile hints, and late bootstrap success/401 after logout/account switch. Repeat secure-token startup and navigation in desktop.
- [ ] Deny microphone capture, change permission, and explicitly retry the same channel from sidebar and dock. Cancel/unmount during capture stops late tracks. Repeat on a real desktop runtime; the UI must not promise it can force a browser-blocked permission prompt.
- [ ] Two users share 16:9, 4:3, 21:9, and portrait content. Inspect all four edges in normal, focus, floating, and native fullscreen; camera behavior and video playback remain intact. Shared-audio volume dips are a separate unresolved gate.

Use this checklist for every production release candidate before tag/publish.

For releases that touch voice, WebRTC, LiveKit, service workers, build output, or audio settings, also complete `docs/VOICE_RELEASE_SMOKE_TEST.md`. If the release touches noise suppression, CSP, service workers, build output, or production deployment config, also complete `docs/VOICE_SUPPRESSION_SMOKE_TEST.md`.

## Release Candidate Info

### v0.4.0 preparation (not release sign-off)

Version metadata is prepared for `0.4.0`; this does not certify release readiness. Complete remaining planned improvements before recording the final candidate commit. Rebuild that exact commit in WSL with Docker and isolated test data, then test the real backend and UI at 1920x1080 plus narrow desktop/mobile regressions. Mocked browser tests are supplementary, not a substitute for this check.

Record real desktop smoke results, two-user voice/screen-share and moderation/reconnect checks, real-device mobile background-audio results, required CI/security/build results, and any platform limitations before publishing. Keep the upstream-blocked glib advisory (#242) explicitly documented rather than marking it fixed.

For the final tag build, verify Docker images `voxpery/voxpery-server:v0.4.0` and `voxpery/voxpery-web:v0.4.0`, the embedded web badge/build tag, desktop version `0.4.0`, and the release-generated updater `latest.json` version all agree. Do not publish a placeholder updater manifest or tag unvalidated images as a release. Leave sign-off fields unchecked until the final candidate is tested.

### v0.4.0 chat and layout checks

- [ ] Desktop (1024 px and wider): the member list button in a server channel header hides and shows the member panel; the chat widens, the draft and scroll position stay, and the choice survives a reload. Below 1024 px the button still opens the member sheet.
- [ ] Mobile: the channels button in the chat header opens the channel list; choosing another channel closes it, and the previous channel keeps its draft.
- [ ] With a server channel open, focus another window and send messages from a second account: the channel shows unread, and returning to Voxpery shows the "New messages" divider before them. Repeat in a DM.
- [ ] Linux desktop: joining voice shows "Voice not supported here" with the browser suggestion, not "Voice connection failed".
- [ ] Server name menu: Invite People copies the invite link with Copied feedback for owners and regular members; Server Settings opens settings; Escape and outside clicks close the menu and return focus. Desktop and mobile.
- [ ] Search in a server channel and a DM: results open beside the chat (desktop) or as a sheet (mobile) with count and scope; the chat and draft stay; Go to message opens an old message with its surrounding messages (server channel) or after loading history (DM); closing search keeps the chat position.
- [ ] Scroll up in a busy channel while a second account sends messages: the view does not move, the jump button shows the new message count, and a "New messages" divider marks the first one. Mentions show a red @ badge in the channel list and a mention count on the server icon.

### Chat state regression checks (#361)

- [ ] Open an attachment preview using Enter. Initial focus is inside the dialog; Tab/Shift+Tab stay inside, Escape closes it, and focus returns to the trigger. Background controls are inert until dismissal.
- [ ] At 320/390px and landscape, closed Social/channel drawers are excluded from Tab navigation. Open drawers remain interactive; desktop sidebars stay visible after resizing.
- [ ] Compact Attach, emoji/media and Send hit targets are at least 44px without enlarged icons or overlap. The counter appears near the character limit. Empty/whitespace Create, Join and Send stay disabled; uploaded attachment-only messages remain sendable and pending/failed uploads stay blocked.
- [ ] Audit Log has one heading and readable category/raid actions. Safety raid rows show counts and time windows; raw metadata is available only after expanding Event details and wraps without horizontal overflow.

- [ ] At 1920x1080, verify the first active-voice server outline is fully visible. Drag servers to first/last slots and across a long scrolling list: a clear insertion marker follows the destination and order persists after reload. Social/Create/Join remain reachable.
- [ ] Visit every Server Settings panel and Safety subtab with an authorized owner/moderator. Long Roles and Raid Events content stays inside cards and can scroll to the final item. Repeat at 1024x600; verify member-only views cannot perform privileged actions.
- [ ] Open Quick Search: Direct messages, Servers, and Channels have distinct headings; filtering, ArrowUp/Down, Enter, Escape, and Tab containment follow the visible order. Empty results have no empty group headings.
- [ ] Scroll a long Quick Search list at 1920x1080 and a compact width. The dimmed background has no full-screen blur, pointer hover does not move the list, and keyboard selection remains visible. Compare production-build frame times on the test device; do not infer native/GPU performance from headless samples alone.
- [ ] Switch photo-heavy channels repeatedly and add/remove a reaction on an image: cached previews do not flash or resolve again solely because signed URL parameters renew. Wide/portrait/square image frames have no empty right-hand box, preserve their aspect ratio, and do not move a history reader.
- [ ] Create and rename a category, text channel, and voice channel containing `#`. Category URL paths remain encoded; invalid characters, consecutive spaces, overlong names, uniqueness, and authorization rules still apply.
- [ ] In the default community welcome guide, Message opens text chat and Join voice starts the normal microphone/LiveKit join flow; the project link and duplicate default task pills are absent. A voice channel without Connect permission cannot be joined. Custom starter tasks and recommended channels still appear. Check dismissal and wrapping at 1100px and 390px.
- [ ] In the account dock, clicking the avatar opens the profile; clicking either the username or status line opens one status menu. Keyboard activation and narrow/mobile profile access remain usable.
- [ ] With a long account name in the desktop dock, the name truncates without overlapping Online, the status control, avatar, or Settings; hover shows the full name. The compact mobile dock stays aligned.

- [ ] Download a ZIP in channel chat and DM: inline progress/start feedback appears; rapid repeated clicks do not create duplicate downloads. Simulate a failed request and retry. Confirm the actual file in the browser/desktop downloads folder (start feedback is not completion confirmation).
- [ ] Switch all Settings tabs at desktop and small-window sizes: the outer dialog height remains stable and content can scroll when necessary.
- [ ] From an old pinned server message outside the loaded history, use Go to message: the target loads and is highlighted. Newest returns to live history; a deleted target reports an error. Verify keyboard channel/member/voice menus and Create/Join Server dialog Tab, Escape, and focus return on web and desktop.
- [ ] Hover grouped messages in wide and narrow chat panes: actions never cover glyphs or move text on hover. Send portrait and wide photos: inline previews show the full frame at a bounded size and still open the image viewer.
- [ ] Open a chat external link in wide and narrow windows: the warning URL stays readable without horizontal overflow, and Cancel/Escape returns focus to the link.
- [ ] Open a DM with more than 50 messages and scroll upward through multiple pages without jumping to the bottom or skipping messages.
- [ ] Return to a previously read DM/channel, including after switching servers: normal entry shows the latest messages. Explicit notification/history jumps still show their target.
- [ ] At 1920x1080 on web and desktop, rapidly switch cached/uncached channels and DMs, including while an older request is pending. Load a delayed GIF/photo, refresh content without changing the message count, and expand the composer: latest mode stays at the bottom without an unsolicited Newest action.
- [ ] Read history using wheel, touch, scrollbar, and PageUp/Home; load older pages and allow media/reactions to resize. The visible message remains anchored rather than snapping to latest. Verify pinned/search/notification targets remain visible after delayed measurements. The small bottom-right latest arrow has an accessible name/tooltip, does not reserve a full-width strip or change chat height, and restores latest mode when clicked. Repeat at a narrow desktop and mobile viewport. The automated Chromium tests do not replace a real Tauri check.
- [ ] Check 1920x1080, 1024px, 1023px, 800x600, and mobile: desktop panels remain at 240px; below 1024px drawers/member sheets remain reachable. Type messages, view square/portrait/wide photos, open search, and resize with a draft and while reading history. No clipping or unwanted scroll jump occurs.
- [ ] Open the shared emoji/GIF/sticker picker beside Attach files using pointer and keyboard; all tabs remain usable without covering the composer. Reopening, switching conversations, and reloading remember the selected tab. Escape returns to the trigger. The right side contains only the character counter and Send; the attachment button works from the keyboard and read-only controls stay disabled.
- [ ] Scroll slightly upward: the latest arrow stays hidden without forcing the chat downward. Scroll further: the arrow appears inset from the scrollbar, without resizing chat/composer; click it to return to latest.
- [ ] Attach a photo and ZIP: preview cards show filename, size, and honest upload activity, then become ready without changing height. Sending stays disabled while uploads are pending/failed; remove and failed-upload retry work. Reduced motion disables animation; narrow layouts do not overflow.
- [ ] Open Settings: initial focus, dialog name, Tab/Shift+Tab containment, inert background, Escape, and focus return work on web and desktop. Repeat account subdialogs and the voice-device listbox without submitting sensitive changes. The app remains interactive after closing.
- [ ] At 320px, 390px and 800px, open Settings directly from the topbar gear beside Quick Search in both Social and Servers. No profile detour is needed; Escape/Done restore trigger focus. At desktop width, only the account-dock gear is shown. Social's Friends row stays separated from the header divider; the DM heading count represents conversations, not unread messages, and per-conversation unread indicators remain. Presence subtitles stay readable in dark/light themes. Hover truncated DM, member, voice and channel names to read their full labels; channel descriptions do not replace the name.
- [ ] At 320x568, 390x844, 800x600 and short landscape sizes with many servers, Create/Join Server stay visible above the account dock. Open/cancel both dialogs, scroll to the last server, and verify that neither action is covered by profile/voice controls.
- [ ] At 800x600 and 320x568, switch every personal Settings section with the named section selector. About and Done remain reachable, the frame stays stable, content scrolls without horizontal overflow, and resizing to desktop preserves the selected section. Verify the Desktop option in the real Tauri client.
- [ ] Open Export, Delete account, Username, Email, and Password from Settings. Cancel, Escape, and backdrop dismissal close only the child, return to its original tab and trigger, and clear private drafts. Reopening starts clean. Successful export returns to Privacy & Data; successful deletion and password changes retain authentication guardrails.
- [ ] Check every personal and Server Settings section, including Roles, Community, Audit Log, Reports, AutoMod, and Bans: no background gradients, backdrop blur, or decorative filter/shadow effects. Flat surfaces, selected states, keyboard outlines, warnings, and live microphone feedback remain readable across dark/light/custom themes.
- [ ] Repeat focus containment in Server Settings, Create/Edit Channel and category forms. Cancel nested discard/delete confirmations and verify focus returns to the parent; discarding unsaved Settings restores its server-header opener and removes background inert state.
- [ ] At 390x844, open channel and DM search: a readable query field fills the compact header, Close remains visible, and closing restores the title/pin/member controls without horizontal overflow.
- [ ] On desktop and portrait/landscape compact layouts, Escape and Close return conversation-search focus to its trigger and clear the query, including Ctrl/Cmd+F entry. Opening Pins instead retains focus on the Pins button.
- [ ] Below 1024px, About and Compare expose Compare/Source/Contribute/Security through Open navigation without desktop-only download, Self-host or Releases actions; verify Escape, outside click and link selection dismiss it. Desktop links remain visible without opening a menu.
- [ ] Verify Communication selects, voice-volume sliders, sensitivity/activation selects, AutoMod fields and role color have accessible names. Assign then clear a microphone shortcut: web feedback describes the focused tab, desktop feedback describes the global shortcut.
- [ ] On login/signup, clicking each visible field label focuses the correct input. Keyboard links preserve post-auth redirects; password and confirmation have distinct accessible names and correct autofill hints. Legal acceptance gating stays unchanged.
- [ ] Change Custom Light between distinct colors: chat, panels, Settings, headers, and inputs visibly update; text stays readable. Changing only accent does not recolor surfaces. Refresh and reopen Settings to verify persistence; Reset defaults clears both overrides.
- [ ] Receive a DM while it is open, and while the app is backgrounded: unread clears when viewing/returning to the conversation, not when merely prefetching or loading older messages.

### Candidate details

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
- [ ] `Checks / Desktop` (Linux launcher validation, desktop `cargo check`/`cargo test`)

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

## 3) Focused Interaction Regression Pass (when affected)

- [ ] With the same account in two sessions, join a server and edit the profile in one session. The other updates its server list and own profile without reloading. Disconnect/reconnect the second session and verify reconciliation. Open the own profile: About me and Member since appear when available.

- [ ] Open a profile from a message author, member row, and bottom-left own avatar/name. The separate status control still changes status; Edit profile opens settings.
- [ ] In Profile settings, select landscape, portrait and square photos. Drag and use the Zoom slider, mouse wheel, and arrow keys; the round preview matches the saved square image. Centered editing actions remain reachable. Changing files replaces the draft, Cancel/closing Settings keeps the old avatar without a profile request, and Save updates it once. Retry after a failed save; unsupported or oversized files show an inline Profile error. Clicking the error does not close Settings; a valid selection clears it. Repeat at 320px and on desktop.
- [ ] Create a server: its welcome guide starts disabled with no selected channels. Configure multiple text/voice channels and enable it. Text opens chat and voice uses the normal join flow. Renaming updates labels; deleted channels disappear and replacements are not selected automatically. Dismiss and reload; disable in server settings and reload. Existing preferences remain unchanged.
- [ ] Select an oversized profile image: the error appears below photo controls without moving the profile card or About me field. Clicking it keeps Settings open; a valid selection clears it.
- [ ] Edit a multiline message: Enter saves, Shift+Enter adds a line, Escape cancels, and IME composition does not submit. Save and Cancel remain reachable in narrow chat panes.
- [ ] Desktop channel/member panels keep their default widths with no resize handles. Previously stored widths have no effect after reload; narrow windows use the compact drawer/sheet layout.
- [ ] Switch Custom theme between Light and Dark, set an accent color, and reload: palette, control contrast, and selection persist without unreadable links.
- [ ] Signed-out `/` and signed-in `/about` show the landing page; signed-in `/` still opens the app. `/compare` opens directly and after refresh with its own title/canonical URL. All three public routes keep the same logo size and header alignment. `Open Voxpery` returns to the app and still enforces current legal acceptance. The desktop landing navigation fits without overflow, and the Contribute link opens the contribution guide.
- [ ] At 1920x1080, 1366x768, and 1024x768, the full landing preview, actions, and legal footer fit without vertical scrolling or image cropping. Compare's default view also fits these desktop viewports with its complete table and footer. Expanded sources and shorter windows may scroll naturally. At 1023px and below, desktop installer/release links are absent and the browser entry is prominent; test 800x600, 390x844, and 320x568 with natural scrolling and usable compact navigation. Compare highlights Voxpery, preserves keyboard-scrollable comparison data, sources, and legal links, and makes no unsupported performance claims.
- [ ] Inspect Social with pinned and recent DMs, unread counts and a long name: headings are readable, rows remain compact, the selected conversation is marked, and a long list scrolls without horizontal overflow. Pin/hide/context actions remain usable on desktop and touch layouts.
- [ ] Verify the inset Friends navigation button is outlined even when inactive, has visible keyboard focus, and aligns with conversation rows. DM hide controls appear on hover or keyboard focus, stay visible on touch layouts, and hide only their conversation without opening it. Long names and unread counts do not overlap the controls or change row dimensions.
- [ ] Compare Social's right panel, the server member panel, and the support footer in dark, light and custom themes: all use the same flat surface without a panel gradient or decorative shadow. Community, Star on GitHub, About and Support have matching lightly filled button surfaces, thin borders and hover/focus states. A trailing chevron marks Community and an outward arrow marks external links; only the leading star/heart icons have a subtle accent. Social's dock has no redundant brand heading. Check Support's entire row, including its padding, in Social and server views. Member rows retain their existing dimensions and interactions.
- [ ] With enough servers to overflow the rail, move the pointer outside it: the scrollbar thumb is hidden. Hover, keyboard-focus an icon or drag a server: the thin thumb appears without moving icons. Wheel/keyboard scrolling, first/last reorder slots, active-voice outlines and fixed Social/Create/Join controls remain usable. A short server list has no unnecessary scrollbar.
- [ ] Right-click a member, a DM and a voice participant, including your own voice row. Member/DM menus share a 224 px preferred width; voice menus start at the avatar and fit the remaining sidebar width. Menus open below the row when space permits, otherwise flip/scroll without covering it. Check long names, volume/move controls, permissions and Escape/focus restoration in short desktop and compact mobile layouts.
- [ ] At 1920x1080 and 1024x600, Social's 240 px information sidebar shows Friend Activity above Community, Star on GitHub, and About Voxpery, with no redundant brand heading. Social, DM, and server views each show one Support Voxpery link in the separate footer, with no GitHub feedback box or bug/feature buttons anywhere. Check Tab/Shift+Tab, Enter, visible focus, long labels and dark/light/custom themes without clipping or footer overlap. Below 1024 px the information panel/support footer remain hidden. Community opens or joins the official server through the existing flow; repository/support/About open outside the active app view. Repeat while connected to voice and watching a stream: playback and connection continue. Server member lists stay unchanged.
- [ ] In the expression panel, scroll results without moving the tabs/search/filters; use ArrowLeft/Right, Home/End, clear a no-results query, and close using the Close button or Escape. Emoji categories, GIF/sticker collections and favorites expose their selected state. Check all three modes at 1920x1080, 800x600, 390x844 and 320x568 without clipped labels or controls; reopening retains the last mode.
- [ ] With a mouse, empty/filled GIF and sticker favorite stars stay hidden while idle, including the Favorites collection, and appear when hovering a tile. Leaving after clicking a star hides it again. Tab navigation reveals the control and allows toggling; touch devices retain direct favorite access.
- [ ] At 1366x768 and 800x600, login and registration keep the submit button, Google sign-in, and account-switch link reachable through vertical scrolling when necessary; the same controls remain reachable on mobile and in a resized desktop window.
- [ ] From Settings, About Voxpery opens `/about` in a new web tab or `https://voxpery.com/about` in the desktop system browser without leaving the active app session.
- [ ] At 1920px, 1100px, 390px and 320px, Friends has a fixed header/filter/search toolbar, unframed rows and separate profile, message and more-actions buttons. Search is case-insensitive and literal, respects Online/All and clears via Escape or Clear; no-results and no-friends states remain usable. Scroll a long list to its last row without moving the toolbar or covering the account dock. Check long names, offline/DND labels, dark/light/custom themes and keyboard focus. Add friend clears search and focuses the username; Enter sends once, disables pending controls, retains the draft after failure and permits retry. Search both request lists, then accept/reject/cancel and verify the original actions still work.
- [ ] Friends has exactly Online, All and Add Friend filters, with no duplicate header action. Add Friend includes the sending form and incoming/outgoing lists; its badge counts only incoming requests and names that meaning for assistive technology. Repeat sending with Enter, accepting/rejecting/canceling, search/focus and long badge counts at 320px without truncating Add Friend.
- [ ] On Social desktop, Friend Activity shows only online/DND friends in accessible voice channels, with avatar/name and server/channel context. A sharing friend appears once with a small indicator; non-friend streams, self, offline/invisible users, private/unknown channels and departed servers never appear. Empty/loading/disconnected states are readable. Reconnect hides old activity until fresh snapshots arrive. Repeat long names and many rows at 1920x1080, 1100x600 and 1024x768: only activity scrolls, resource links and Support stay reachable, and mobile keeps the dock hidden.
- [ ] Click and keyboard-activate a streaming and non-streaming Friend Activity row, both outside voice and while connected to another channel: only the correct server/channel opens. There is no Join/Watch confirmation, microphone prompt, voice movement/disconnect or new media subscription. Connect permission is not required merely to view the channel. Explicit Join and Watch in the voice-channel UI still work with real second-user media. Stop watching remains fully clickable in the floating preview's upper-right corner; its outer edge still resizes.
- [ ] In voice participant rows, check camera, LIVE, self mute/deafen and server-only mute/deafen flags, alone and combined, on desktop/mobile and dark/light/custom themes. Tooltips and accessible labels distinguish self/server states; icons and long usernames stay within the panel without glow or duplicate mute badges. The compact channel-active-time clock retains a 72 px width through minute/hour transitions without moving the channel name or truncating `1:00:00`; it is not a personal connection timer. Hide the browser tab and return: elapsed time catches up without changing voice or media state.
- [ ] On Add Friend, blank and whitespace-only usernames keep Send Request disabled with a clearly neutral surface, including on hover. Enter on these drafts sends no request. A nonblank username enables the flat, icon-labelled button; sending disables both controls and completion clears the draft/disabled state correctly. Input and button share the same font and 40 px height. Repeat dark/light and 1920/1024/390/320 px layouts with no clipping, including keyboard focus and retry after failure.
- [ ] While watching a remote screen share, open channel chat and Social/DM: the mini player starts upper-right. Drag to all four corners and shrink/enlarge it: it stays within central content without covering sidebars, composer or call controls; video and screen audio continue without reattachment or resubscription. Size/position survive returning to voice and leaving it again. Repeat keyboard movement, viewport resizing and a narrow mobile viewport. Opening the video returns to the correct voice channel; Stop watching affects only the viewer subscription. It disappears when the publisher stops or the viewer leaves voice.
- [ ] In a two-user call, one remote screen share produces a share tile plus the other participant's avatar, not three cards. Repeat camera-only, camera plus screen (two media tiles for one owner, still two participants), unwatched/hidden media, and local publishing. Available/connecting and hidden cards retain the owner's profile photo or initial; active camera/screen overlays also identify the owner with a compact avatar. Stopping the last media restores that participant's avatar, without changing call membership or audio.
- [ ] Move the watched preview by dragging its body with the primary pointer or touch: releasing a drag does not return to voice; an ordinary click or keyboard activation still does. Only Stop watching and a bottom-left resize icon are visible; all four corners are resizable hit targets with appropriate cursors and keyboard focus. Resize from each corner: the opposite corner stays fixed, native stream aspect ratio is preserved, width limits/content bounds are respected and playback continues. Stop watching sits in the upper-right corner with equal small top/right insets; its entire button surface remains clickable above the resize target, while the outer corner edge still resizes. Test 16:10, square, portrait and ultrawide sources, including a source resolution change: the full frame fits without cropping or added black bars. Move the preview away from content edges before testing growth. Repeat after Friends/DM view changes and composer/viewport resizing; ordinary message/reaction updates do not reset position or size.
- [ ] After visiting a server chat, open Friends and drag the watched preview to each edge: retained hidden chats never cause it to cross the visible central pane or cover server/DM/member panels. Repeat in DM and after switching back to server chat, on desktop and mobile. The owner name overlays the original video with a transparent background, not a full-width dark strip; check readability on bright and dark streams.
- [ ] With at least 12 voice participants plus an active camera and screen share, desktop and mobile grids remain inside the viewport, preserve the shared-screen priority, and do not overlap the call bar or each other.
- [ ] In Friends and Direct Messages, open actions through both right click and the three-dot button near every viewport edge: menus stay inside their owning panel, keyboard focus starts on the first action, and only context-appropriate profile/message/friend/DM actions appear.
- [ ] In Friends, DM, channel/category and member/voice action menus, Up/Down wraps between available buttons and Home/End reaches the first/last action. Hidden/disabled actions are skipped. Tab and Escape retain their existing behavior and dismissal restores the opener. Voice volume sliders and channel selectors retain their native arrow/Home/End controls.
- [ ] In the desktop app, verify global push-to-talk while Voxpery is focused, unfocused, minimized, and hidden in the tray: hold transmits, release stops, and focus loss, channel leave, shortcut changes, or switching to Voice Activity never leaves the microphone open.

## 4) Web Smoke Tests (mandatory)

- [ ] Register works.
- [ ] Login works.
- [ ] Password reset request + reset flow works.
- [ ] A Google-only account can request an email reset, establish a local password, sign in with that password, and remain connected to Google.
- [ ] Connecting Google to an existing email/password account does not invalidate the existing local password.
- [ ] Google OAuth login works.
- [ ] Server/channel/category permission scenarios work.
- [ ] The official Voxpery community has no Leave Server action and rejects a direct leave request; members can still leave another server. Migration `049` backfills old unbanned accounts without changing existing roles or join dates; stored sessions see that membership after reload, new and Google sign-ins join, and banned accounts remain excluded.
- [ ] Invite links show the target server, enforce community rules acknowledgement when rules exist, and join into the expected server.
- [ ] Voice join/leave works.
- [ ] `docs/VOICE_RELEASE_SMOKE_TEST.md` completed and recorded as `GO` for voice behavior when the release touches voice, LiveKit/WebRTC, camera, screen share, audio settings, service worker caching, desktop runtime, or build output.
- [ ] `docs/VOICE_QUALITY_BENCHMARK.md` completed and recorded as `GO` when the release changes codec, bitrate, capture constraints, suppression tuning, VAD/gate thresholds, input gain, or LiveKit publish options.
- [ ] Voice access revocation works: kick, ban, moderator disconnect, and removing `Connect to Voice` immediately remove the affected user from the active voice room.
- [ ] With two web or desktop clients, a moderator server-mutes and server-deafens a participant: the participant cannot publish or subscribe, remains restricted after leaving and rejoining, switching voice channels in the same server, and reconnecting WebSocket/LiveKit. A regular member cannot clear either restriction; moderator unmute/undeafen restores voice without another call join, and the audit log has only the actual moderator actions.
- [ ] On web and desktop, right-click or keyboard-open your own voice participant row (`Shift+F10` or the Context Menu key). Only an already active server mute/deafen with the matching permission offers self-unmute/undeafen. The menu omits self move, disconnect, and server mute/deafen. Verify that personal mute/deafen remains independent, unauthorized requests are rejected, and successful releases appear in the audit log.
- [ ] Camera self-preview recovers after switching from an active voice channel to another chat, DM, or server and then returning, while the remote user keeps seeing the camera feed.
- [ ] Remote camera and screen-share tiles can be hidden and shown again without leaving voice; hiding media unsubscribes its remote publications for that viewer while normal microphone audio continues.
- [ ] In a call with at least five participants, local or remote speaking-state changes do not restart, mute, or interrupt watched screen-share audio; voice and stream audio remain independently audible.
- [ ] While self-deafened or server-deafened, remote participant speaking rings stay hidden in both the channel sidebar and voice stage; undeafening restores current speaking feedback without reconnecting.
- [ ] Sharing a window requests only that selected window's audio and excludes Voxpery's own browser surface; runtimes without selected-window audio support fall back to a silent window share rather than broadcasting unrelated system/call audio.
- [ ] Adding reactions to three consecutive messages keeps every reaction row below its own message on desktop and mobile; a user reading history keeps the same scroll anchor while a bottom-anchored user remains at the latest message.
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
- [ ] At 1920x1080 and a narrow desktop viewport, channel/Social and member/friend sidebars retain their default widths with no resize handles. Old saved custom panel widths have no effect after reload; mobile drawer/member-sheet behavior remains unchanged.
- [ ] Right-click and keyboard-open member and voice participant actions near the viewport edges, including a full moderator menu in a short window. Menus open below their source row or flip above, never covering it, and stay horizontally inside the owning panel; internal scrolling does not dismiss them, and the channel picker and volume slider remain usable. Escape returns focus to the row; a nested mobile member menu closes before the member sheet. Repeat on web and desktop.
- [ ] Open a profile with a long username, no avatar, a 190-character About me, and many roles. The larger avatar/text remain readable, content scrolls without horizontal overflow, and narrowing the window does not hide the open profile. Check Tab/Shift+Tab, Escape, and focus return on desktop and mobile; compact sidebar/message avatars retain their original sizes.
- [ ] Login, registration and idle application use do not open a notification opt-in banner or native permission prompt. With permission unset, wait longer than two minutes at 1920x1080, 1100x600 and a phone viewport; layout stays unchanged and search/composer remain usable.
- [ ] Open Settings > Communication and explicitly enable Browser/Desktop notifications. Only this action requests permission; opt-in persists after reload, opt-out disables delivery, and blocked/unsupported states remain accurate. Foreground and DND delivery guards are preserved. Repeat in the desktop app.
- [ ] Web app is installable as a PWA; a normal reload (without `Ctrl+F5`) discovers the current release; the app shell and `/sw.js` require revalidation; and the service worker does not cache API, auth, WebSocket, or navigation responses.
- [ ] Production voice call with noise suppression on does not reuse a stale cached RNNoise worklet after deploy.
- [ ] Uploaded chat image attachments render inline after channel/server navigation and open only in the in-app preview modal on web and desktop, with no external tab/browser navigation.
- [ ] On web and desktop, clicking a ZIP attachment in chat starts a download with the expected filename; the saved archive opens and its contents match the uploaded file.
- [ ] Switch rapidly between two servers with distinct channels/categories, including a slow response and a return to a previously visited server: no channel or category from the other server appears, even briefly.
- [ ] Run `npm run test:e2e:ui-smoke` for the required `@core` basic feature checks: auth/account, invite/join, permissions, channel and DM messages/actions, Friends/requests, server profile/roles and voice readiness. CI keeps one worker and the existing lint/unit/build gates; it does not run the full visual matrix.
- [ ] Run `npm run test:e2e:mobile-smoke` for compact navigation, composer, member-sheet and Settings access. Detailed theme/media/layout regressions remain available on demand via `npm run test:e2e:ui-regressions`, not as an additional scheduled CI job.
- [ ] Automated mobile web smoke completed for the release candidate or CI run, covering Social, DM, server chat, mobile composer actions, and the mobile member sheet.

## 5) Desktop Smoke Tests (mandatory)

- [ ] Inspect normal/unread tray and taskbar icons at Windows 100%, 125%, 150% and 200% scaling, on light/dark taskbars. Small icons must match the original fox logo in `apps/desktop/src-tauri/icons/icon.png`, without the former wider small-icon redraw, stretching or clipped ears/chin. Transparent margins, tray Show/Quit, unread feedback and original large installer icons still work. Restart or repin the updated application if Windows displays a cached old icon.
- [ ] Assign the microphone toggle to a supported letter, F key and modifier combination. Verify exactly one toggle per key press while focused, unfocused and minimized/in tray. Rebind, restart with the saved binding, clear, test an occupied shortcut and push-to-talk conflict, and confirm recording/pending saves cannot toggle or overwrite each other. Web copy must promise only focused-tab behavior, not system-wide delivery.

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
- [ ] On a Linux `.deb` build, the first voice join shows Voxpery's native microphone prompt; allowing it connects voice, denying it leaves voice disconnected, and retry offers the prompt again. No missing-portal message is shown for a generic capture failure.
- [ ] Voice join succeeds after permission grant.
- [ ] An account with missing or stale Terms, Privacy Notice, or KVKK versions sees the blocking legal review before app/voice data loads; all three links open, unchecked submission is disabled, acceptance unlocks the same session, refresh stays unlocked, and logout remains available.
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

## 6) Final Sign-off

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
