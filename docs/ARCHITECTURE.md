# Architecture

Voxpery is a real-time communication stack: Rust backend + React frontend + LiveKit SFU.

## Google Registration And Legal Acknowledgements

Application startup restores identity and legal-document status through one authenticated `GET /api/auth/session` snapshot. The auth store coalesces concurrent bootstrap requests, holds the status only in memory, and ignores late success/error responses after logout or account changes. Persisted profiles are display hints, not proof of authentication or acceptance. App routes wait for this snapshot; public auth/legal pages remain available during outages. Session failures have explicit retry/logout actions rather than implying missing acknowledgement.

The legal boundary consumes the startup snapshot without another request or a separate document loader. A server `428`/WebSocket consent signal invalidates the in-memory snapshot and refreshes the status; explicit acceptance updates the same session. Backend API/WS gates remain authoritative, including after document-version changes. Each hard refresh still validates the session once; caching acceptance across reloads is intentionally avoided.

The server supplies current legal-document versions through public metadata. Sign Up and the authenticated consent boundary share the same acknowledgement component; load failure is separate from missing consent, and failed saves preserve valid selections. Gate state is keyed to the authenticated identity and ignores stale requests.

Google callbacks require a verified provider email. Existing accounts keep the normal sign-in path and acknowledge only missing/stale versions. New accounts arriving with valid Sign Up metadata use the fast path; otherwise a cookie-bound pending context leads to a server-rendered completion form. Both paths use the same transaction-level account/audit creation service. Pending completion additionally locks and consumes its short-lived context atomically. No account or full session is issued before actual acknowledgement. Desktop results remain PKCE-bound single-use exchange codes; the browser completion page has no native IPC access.

## Stack

| Layer | Technology |
|---|---|
| Backend | Rust, Axum, SQLx |
| Database | PostgreSQL 16+ |
| Cache/Coordination | Redis (JWT blacklist, distributed rate limiting, WS event bus) |
| Frontend | React 19, TypeScript, Vite, Zustand |
| Voice | LiveKit |
| Realtime signaling | WebSocket |
| Desktop | Tauri 2 |

## High-Level Data Flow

1. Auth: user logs in, backend issues JWT.
2. Web session uses httpOnly cookie; desktop uses Bearer token.
3. Client subscribes to channels via WS.
4. Message CRUD goes through REST; backend broadcasts updates over WS.
5. Voice permission and presence state are coordinated over WS.
6. Media path itself is LiveKit (backend only issues token).

## Backend Structure

`apps/server/src`:

- `routes/` REST endpoints (`auth`, `servers`, `channels`, `messages`, `friends`, `dm`, `webrtc`)
- `ws/` websocket protocol and handlers
- `services/permissions.rs` role bitmask + effective channel/category calculations
- `services/rate_limit.rs` Redis sliding-window limiter
- `ws/bus.rs` Redis Pub/Sub bridge for cross-instance WS event fan-out
- `middleware/auth.rs` token extraction and auth guards

## Permission Model

- Server permissions come from implicit `Everyone` + assigned roles.
- Effective channel permissions:
  - server bitmask
  - category overrides (deny then allow)
  - channel overrides (deny then allow)
- Server owner is full-access override.

## Realtime Model

- `tokio::broadcast` is used for each process-local fan-out stream.
- Redis Pub/Sub bridges broadcast and targeted user WS events between backend instances.
- Per-user active WS sessions are stored in-memory (`DashMap`) on the instance that owns each socket; REST list endpoints that derive online/offline from this map are instance-local until presence is externalized.
- Voice session/control state is still tracked in-memory for low-latency UI sync; run sticky WebSocket routing for multi-instance voice until this state is moved to Redis or another shared coordinator.

## Chat Scroll Ownership

- `ChatArea` owns scroll intent for the active conversation. Normal channel/DM entry and returning to a hidden chat select latest mode; late media measurements, composer resizing, and same-count data refreshes keep that mode until explicit user input changes it.
- Wheel, touch, scrollbar, and scroll-key input distinguish history reading from passive layout changes. Search, pinned-message, notification, and reply targets cancel pending latest work so the target is not overwritten.
- Deferred scroll work is guarded by conversation identity and a generation invalidated on navigation or history intent. Parents scope displayed messages to the active channel/DM; late responses cannot display a different conversation's rows.
- TanStack Virtual's end anchoring preserves visible history during row measurements. Prepending older messages retains the existing message anchor. Resize observers keep latest mode pinned after content or viewport size changes, without fixed-delay retry timers.
- A small, icon-only latest-message action floats above the composer, inset from the scrollbar. It appears after reading 160-320 px away from latest (depending on viewport height), with hysteresis to avoid flicker; explicit history targets still offer a return action. History intent disables automatic scrolling immediately, independently of button visibility. The action never resizes the message viewport, and its accessible name and tooltip describe the action.
- The composer groups attachments and a single expression-picker trigger on the left, with the remaining-character count and Send on the right. Emoji, GIF, and sticker tabs share the existing picker and remember the last selected tab in device-local preferences, including after navigation/reload. Reaction pickers remain emoji-only; file selection is keyboard accessible.
- The expression panel uses flat semantic theme colors, a fixed tab/search/collection toolbar and independently scrolling results. Expression tabs support arrow keys, Home and End; category/collection and favorite controls expose their selected state. Clear search restores input focus; Close and Escape restore the composer trigger. Picker media previews load lazily and GIF tiles reserve their aspect ratio without cropping. Inline chat media retains its eager loading behavior.
- Social conversations use compact, borderless avatar rows with readable Direct Messages, Pinned and Recent headings and an explicit selected-row marker. The Friends row has spacing below the sidebar header; the heading omits a conversation count to avoid confusion with unread notifications. Long names truncate within the sidebar; unread and hide controls do not resize rows, and touch layouts keep the hide action visible. Existing ordering, pin/hide and context-menu behavior is unchanged.
- Attachment drafts use stable-sized preview cards with filename, size, state, remove, and failed-upload retry controls. Only supported raster images are previewed; local and authenticated desktop blob URLs are revoked after replacement/unmount. Upload activity is indeterminate rather than a fabricated percentage, respects reduced motion, and keeps sending disabled until all files are ready. Upload validation and access control are unchanged.
- Authenticated attachment previews use content identity rather than rotating `exp`/`sig` parameters only for matching attachment paths on the application/API origins. Identity retains the origin, attachment path, other query parameters, content hash, media type, and account/auth scope; external URLs are not normalized, even when their paths resemble the attachment API. Decoded previews survive reaction responses and cached channel switches without remounting, while a failed preview can retry with a renewed signed URL. Inline image frames are bounded by the same width as their images.

## Sidebar and Member Overlay Layout

- Friends uses a fixed title/filter/search toolbar and an independently scrolling, unframed list. Online, All and Add Friend are the only top-level filters; Add Friend contains submission and incoming/outgoing requests, without a duplicate header action. Its badge counts incoming requests only and exposes that meaning to assistive technology. The internal persisted `requests` filter key remains compatible. Local case-insensitive literal search respects presence filters and filters both request directions, without new network calls or polling. Avatar/profile, row/message and explicit message/more-actions buttons remain separate. Add Friend clears search and focuses the username field; the form supports Enter and suppresses concurrent submissions, retaining the draft on failure. Flat theme-aware surfaces and static loading placeholders avoid decorative animation, blur and gradients. Compact layouts retain visible filters/search and reserve the account dock space.
- Social's Friend Activity section derives only online/DND friends in accessible voice channels from cached friends, servers/channels and WebSocket presence/control events. A sharing friend appears once with a small screen-sharing indicator, not a separate stream group. Non-friends, self, offline/invisible friends, unknown/non-voice/non-visible channels, departed servers, mismatched server presence and stale socket generations are excluded. Empty/loading/disconnected states are explicit. The activity list scrolls independently above the resource links; compact layouts keep the right dock hidden. Avatars decode lazily with failed-image initial fallbacks; there is no polling, media preview or identity-fetch loop.
- A Friend Activity click revalidates current account, connection generation, friend presence and channel visibility, then navigates to that server/channel only. It never joins, moves/leaves voice, requests microphone access or subscribes to media; the former Activity Watch bridge and confirmation dialog are removed. Explicit voice entry and stream watching remain in the voice-channel UI with existing backend authorization.
- Voice participant rows use flat LIVE/camera indicators and Lucide mute/deafen icons with explicit tooltips and accessible labels. Effective server mute/deafen flags are included even when self flags are false. Server-enforced states use the warning color. The fixed-width, tabular-digit clock indicates channel active time from `voiceChannelActiveSince`, not the viewer's personal connection duration. Only the isolated counter rerenders each second; hidden-document updates pause and resume from wall-clock time. It has `aria-live="off"` to avoid announcing every second and releases its interval/listener on unmount.

- Social's right information sidebar retains the desktop 240 px width and compact-layout hiding behavior. Full-row Community, Star on GitHub, and About actions replace the promotional cards, without a redundant brand heading. All actions, including the shared Support footer link, use a lightly filled button surface with a thin border and matching hover/focus states. A trailing chevron identifies the internal Community action; an outward arrow identifies external links. Only the leading star/heart icons have a subtle accent. Social, the server member sidebar, and their shared Support Voxpery bottom dock use the same flat `--bg-surface` color, without a sidebar gradient or decorative panel shadow. The old GitHub feedback component and styles have been removed entirely. Member row layout is unchanged. Community retains the existing official-server open/join flow. External links use `openExternalUrl`; About opens the local `/about` page in a new web tab or the public About page in the desktop system browser, without replacing the active app or changing voice/viewer state.
- Below 1024px, UserBar portals its existing Settings trigger into a dedicated topbar slot beside Quick Search. The same dialog state and focus restoration are retained, without duplicating account controls or crowding the bottom voice dock. Desktop keeps the trigger beside the account profile.
- The compact icon rail reserves the fixed account dock and safe-area inset below Create/Join Server; only the server list scrolls. Notification opt-in is manual through Settings > Communication, with no delayed banner/timer or automatic permission request. Existing notification delivery and opt-in preferences are retained.
- CSS owns the default 240 px desktop sidebars at viewport widths of 1024 px and above. Below 1024 px, narrow desktop windows and mobile share the same chat-focused layout: channel/Social panels open as drawers, members open as a sheet, and the account dock stays reachable. `layout.ts` supplies the matching JavaScript boundary, including voice controls and virtual-message measurements. Panel resizing and JavaScript width overrides have been removed; legacy `voxpery-panel-widths` storage is ignored.
- Member and voice participant menus render through body portals rather than inside sidebar clipping/transform contexts. Member, voice, and Social action menus share `useViewportMenu`: they open below the source row, flip above when necessary, and scroll within the available space rather than covering the row. Actual dimensions and visual-viewport changes determine screen bounds; horizontal bounds and maximum width follow the owning panel with an 8 px inset, preserving readable labels and usable moderation controls without spilling into chat.
- Scrolling inside an action menu keeps it open; scrolling its surrounding page or sidebar dismisses it. Escape restores the triggering row, and native select/volume keyboard controls retain their normal behavior. Permission filtering and moderation commands are unchanged.
- Member profile dialogs also render outside their originating sidebars so hiding or transforming a responsive panel cannot hide an open profile. Dialog-specific styles enlarge the profile without changing compact avatar rows; existing Escape, focus trapping, and focus restoration remain in place. A mobile member sheet defers keyboard dismissal to a nested profile or action menu first.
- Settings and its account dialogs use `useDialogFocus` for initial focus, Tab containment, inert background siblings, and focus restoration. The top dialog owns focus, including the voice-device listbox portal; nested cleanup restores the original inert state. Existing Escape and account-save behavior remains owned by `UserBar`.
- All Settings account forms, including export and deletion, keep the parent Settings mounted. Cancel, Escape, and backdrop dismissal clear private form drafts and restore the originating tab, scroll position, and trigger focus. Successful deletion and password-change reauthentication retain their logout flows. Below 1024 px, a single named section selector replaces the tab grid and the redundant subtitle is hidden; desktop navigation is unchanged.
- Server Settings and channel/category forms use `ModalSurface` with the same focus scope. Nested discard/delete/report dialogs own focus until dismissed; closing both Settings and its discard confirmation restores the server-header entry point. Existing permission checks, submissions, and Escape handlers remain in `AppLayout`.
- Compact conversation search replaces the title and secondary pin/member actions while open, giving its query field the available header width. Closing search restores the normal header; desktop keeps its existing layout.
- Public About/Compare headers share the application's 1024 px boundary through `useCompactLayout`. Compact navigation retains Compare, Source, Contribute, and Security, while desktop-only download/release/self-host entry points are not rendered. Escape, outside clicks, and selecting a link dismiss the menu; no backdrop blur or new dependency is required.
- The footer avatar opens the own-profile dialog; the combined username/status button opens status controls. Quick Search groups DMs, servers, and channels, retains relevance ordering inside each group, and uses the displayed order for keyboard selection. Its dialog contains and restores focus.
- Quick Search dims the background without a full-screen backdrop blur. Only keyboard selection and query changes scroll the selected result into view; pointer hover updates selection without fighting native list scrolling.
- UI decisions prioritize responsiveness and low CPU/GPU/memory usage over decorative effects, while retaining readable contrast, accessibility and functional feedback. Evaluate expensive effects with production-build frame/resource measurements before adding them; local headless results are not a cross-device or competitor benchmark.
- Server rail icons scroll independently from Social/Create/Join controls. Insets preserve voice outlines and insertion markers; reordering computes the destination from current pointer geometry, supports the first/last slots and edge scrolling, and preserves the existing per-account device-local order.
- The overflowing server rail uses a transparent scrollbar at rest and reveals its thumb on rail hover, keyboard focus or active dragging. Chromium/WebKit use a 4 px scrollbar; other engines use their native thin width. Stable symmetric gutters prevent icon movement when the thumb appears. No scroll listener, animation or decorative effect is needed.
- Member and DM context menus share a 224 px preferred width, capped by their owning panel and the visual viewport. Voice actions begin at the participant avatar's left edge and narrow to the remaining sidebar width rather than shifting left. All three retain source-row clearance, upward flipping, internal scrolling and keyboard focus restoration.
- Server Settings owns vertical scrolling in its content column. Cards retain their natural height instead of flex-shrinking and overflowing their borders, including long Roles and Safety/Raid Events content.

## Voice Media Layout

- Voice stage tiles represent media, not participant totals. A participant with a rendered camera, screen share, watch placeholder, or hidden-media placeholder does not also receive an empty avatar tile. Camera and screen share can coexist as two distinct media tiles; participant membership is unchanged. Stopping the last media restores the avatar.
- A watched remote screen continues in a floating preview when navigating away from voice. Dragging the video body with the primary pointer moves it; a six-pixel threshold distinguishes dragging from clicking to return to voice. All four corner hit targets support pointer, touch and keyboard resize; only the bottom-left target displays an icon. Resize preserves the source aspect ratio and opposite corner. The body also supports keyboard movement; redundant drag and size shortcut buttons are omitted. Width varies continuously from 240 to 960 px, bounded further by available content on narrow/short screens. Metadata and video resize events adapt the frame to the actual decoded stream ratio, without cropping, stretching or adding fixed-16:9 letterboxing; before metadata arrives the ratio defaults to 16:9. Dragging stays inside visible central content, above the composer/call bar and outside navigation sidebars. Relative position and size survive voice/chat switches within the same call; viewport changes and replacement conversation surfaces clamp and rebind the preview without measuring ordinary message updates.
- Preview bounds prefer a visible chat surface and otherwise the visible Friends main pane, ignoring zero-sized kept-mounted channel/DM panes. Layout observers follow all matching surfaces and retained-view visibility changes, without reacting to ordinary message updates. Friends uses the same central-content constraint as chat/DM. The preview owner label has a transparent background and small text shadow rather than a full-width dark strip; video content remains unobscured around the name.
- Available/connecting and hidden-media cards retain their owner's avatar (or initial fallback), and active camera/screen overlays include a compact owner avatar. Avatar URLs use the existing image resolution/proxy path; identity does not require a duplicate participant tile.
- Pointer movement paints only the preview transform on animation frames, without rerendering the call or changing subscriptions. Size/move controls do not stop watching; returning to voice and explicitly stopping the viewer subscription remain separate actions. These UI tests do not replace real two-client camera, screen/audio continuity, disconnect, and native-runtime release checks.

## Security Model (Implemented)

- JWT: HS256, expiration-based.
- Password hashing: Argon2id.
- CORS: explicit allowlist only, wildcard rejected.
- Cookie security guardrails enforced at startup.
- Redis-backed rate limits for auth, messaging, and WS connect.
- Permission checks applied on REST and WS access paths.
- WS event fan-out is authorization-aware at delivery time (current visibility/membership re-check).

## Deployment Topology

- Backend is a Rust binary.
- Frontend is static assets.
- Postgres + Redis + LiveKit are external services (docker-compose in dev/self-host).
- Multiple backend instances can share REST traffic and receive cross-instance WS event fan-out through Redis.
- For multi-instance voice/signaling, use sticky routing on `/ws` until voice session/control state is externalized.

## Public Web Routes

- On the web, `/` shows the landing page to signed-out visitors and redirects signed-in visitors to the application. Tauri keeps its existing login and application entry behavior, and the installed PWA keeps its `/` entry.
- `/about` always shows the public landing page. `/compare` is a public comparison page. Neither route requires a legal acknowledgement or backend connection before rendering.
- The landing combines a concise product summary, authenticated/guest browser entry, and a proportionally sized real product preview. Desktop includes platform-aware downloads and published-release metadata; compact/mobile is browser/PWA-focused without installer links. The layout fits common desktop heights but allows natural scrolling on short windows and mobile rather than clipping or shrinking text. Compare highlights inspectable source, Docker ownership, integrated chat/calls, and the Voxpery table column without claiming unmeasured CPU/RAM advantages.
- The in-app Settings menu opens `/about` in a new tab on web or in the system browser on desktop, without replacing the active app session.
- Application routes such as `/social` and `/servers` remain behind session validation, legal-document acknowledgement, and the connection gate.
- The production web server serves a distinct HTML entry for `/compare` so direct requests have the comparison page title, description, and canonical URL before JavaScript runs. Client-side navigation updates those tags as well.

---

Last verified against code on 2026-05-09.
