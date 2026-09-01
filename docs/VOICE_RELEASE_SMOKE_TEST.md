# Voice Release Smoke Test

Use this checklist for every release candidate that touches voice, LiveKit/WebRTC, audio settings, camera, screen sharing, service worker caching, CSP, desktop runtime, or release build output.

The goal is to verify the real user path, not every implementation detail. Run this after automated checks are green.

## Setup

- Use two accounts in the same server.
- Test web first. Test desktop too when desktop artifacts or desktop config changed.
- Use a real microphone and speaker/headset.
- Keep one user as the sender and one as the receiver for media and noise checks.

## 1. Join, Controls, and Cues

- [ ] User A joins a voice channel and User B sees A in the channel list.
- [ ] User B joins the same voice channel and both users hear the join cue.
- [ ] Repeat two-way microphone transmission with Firefox as the first participant and Chromium as the second, then reverse the join order and repeat with the desktop app. Every receiver hears every sender while the speaking indicator is active and RNNoise remains available on each browser.
- [ ] At the default per-user voice level, Firefox-to-Chromium and Chromium-to-Firefox audio use stable native playback. Raising one user's voice above 100% enables amplification without changing screen-share volume or interrupting any other participant.
- [ ] Mute/unmute changes local mic state and does not disconnect the room.
- [ ] The configured mute shortcut toggles the microphone while the web tab is focused.
- [ ] A new/default user joins with the operating system's current default microphone and speaker.
- [ ] A valid custom microphone and speaker remain selected after reload and voice rejoin.
- [ ] After a selected custom microphone or speaker is disconnected, the next capture/playback attempt silently uses the system default and Voice Settings shows `Windows Default`.
- [ ] While already joined, unplugging the active microphone or changing the operating-system default input recovers capture without leaving/rejoining and without removing the existing LiveKit microphone publication first.
- [ ] In desktop builds, the configured mute shortcut also works while Voxpery is unfocused, minimized, or running in the tray.
- [ ] On a clean macOS install, the first voice join prompts for microphone access and Voxpery appears in Privacy & Security -> Microphone after the decision.
- [ ] Rebinding or clearing the mute shortcut takes effect immediately; a conflicting desktop shortcut shows an error without losing the previous working binding.
- [ ] Deafen stops remote microphone playback and restores it when disabled; watched screen-share audio continues at its independent stream volume.
- [ ] While deafened, reconnect a participant and subscribe to a newly arriving microphone track; no voice leaks before or after the track appears, while watched screen-share audio continues.
- [ ] On web and desktop, voice ping starts in the measuring state, uses a real backend WebSocket RTT while RTC settles, and switches to the selected ICE path only after stable samples; joining another channel or reconnecting never flashes a stale or implausible `1 ms` value.
- [ ] User B leaves and User A hears a leave cue that is clearly different from the join cue.
- [ ] Rejoining the same channel does not leave duplicate participants or stale voice controls.
- [ ] With 3-5 members in one channel, every member can hear every other microphone; reconnecting one member restores all expected subscriptions without duplicate or missing audio.
- [ ] If Web Audio processing is unavailable for one remote source, that participant remains audible through direct `MediaStream` playback and the other participants remain unaffected.

## 2. Reconnect and Revocation

- [ ] Refresh the web app while joined to voice; the app either restores/resyncs cleanly or leaves with an understandable state.
- [ ] Briefly interrupt WebSocket connectivity if possible; voice state resyncs after reconnect.
- [ ] Kick, ban, moderator disconnect, or removing `Connect to Voice` removes the affected user from the active room promptly.
- [ ] The removed user cannot keep listening through an existing LiveKit session.
- [ ] Give a non-owner moderator a custom Full admin role. Mute, deafen, disconnect, and move controls appear only for lower members, never equal/higher roles or the server owner.
- [ ] With two real clients, move a lower member to another voice channel. The target leaves the source, joins the destination, the moderator receives success, and the audit entry appears only after the destination is connected.
- [ ] Repeat while the target disconnects, changes channel independently, or cannot join the destination. The moderator receives failure and no successful move audit entry is written.
- [ ] Reconnect the target WebSocket while a move is pending. The request is replayed and completes at most once without duplicate audit entries.

## 3. Camera

- [ ] User A starts camera; User B sees the camera tile.
- [ ] User A hears the local camera-start cue; User B does not hear a channel-wide camera cue.
- [ ] User B hides the remote camera tile and can show it again.
- [ ] User A hears the local camera-stop cue; User B does not hear a channel-wide camera cue.
- [ ] Starting camera again plays one local camera-start cue for User A.
- [ ] Switching from voice to a text channel and back keeps camera UI stable.
- [ ] On a real mobile device with front and rear cameras, User A can switch both directions from the local preview without leaving voice or restarting the remote camera tile; one-camera devices do not show the switch control.

## 4. Screen Share

- [ ] `Presentation` profile publishes at the UI-described 1080p30 behavior.
- [ ] `Video` profile publishes at the UI-described 1080p60 behavior.
- [ ] `Gaming` profile publishes at the UI-described 1080p60 behavior with the higher bitrate profile.
- [ ] `Auto` chooses a balanced profile by shared surface: monitor/browser -> video, window/unknown -> presentation.
- [ ] Monitor/game and browser/video shares stay motion-first under load: frame pacing remains smooth before sharpness is preserved.
- [ ] A VP9-capable Chromium/WebView2 publisher reports `codec: vp9` and `scalabilityMode: L3T3_KEY`; a fallback runtime reports `codec: vp8`.
- [ ] Resizing and fullscreening User B's remote share tile upgrades the received adaptive layer without restarting the share.
- [ ] User A starts screen share; User B sees `Stream available` but receives no screen video or shared-audio traffic before choosing `Watch stream`.
- [ ] User B chooses `Watch stream`; both `ScreenShare` and `ScreenShareAudio` subscribe, while User A's microphone remains continuously audible.
- [ ] While User B watches a stream, hiding/minimizing Voxpery pauses screen video but keeps screen-share audio continuous; restoring the app resumes video without an audio gap or replayed media cue.
- [ ] Shared system, game, and music audio remains stereo and continuous without speech-style gating; diagnostics report `musicHighQualityStereo`, 128 kbps, `forceStereo: true`, `dtx: false`, and `red: true`.
- [ ] On a freshly installed or updated Tauri build, two users hear each other immediately after joining, then while User B watches User A's shared-audio stream, User B speaks and stops at least five times immediately after playback begins; the stream and all remote microphones remain simultaneously audible without startup ducking, gaps, output-device changes, or playback restarts. Repeat with at least five participants on web and desktop.
- [ ] Sharing a source/platform that provides no audio still publishes video without a misleading warning toast.
- [ ] With opt-in diagnostics enabled, requested and actual capture resolution/FPS, audio sample rate/channel count/content hint/publication profile, simulcast, outbound video bitrate/FPS, actual screen-audio Opus bitrate/channels/packets, packet loss, and quality limitation reason are present without device identifiers.
- [ ] Under constrained bandwidth, screen share remains watchable by stepping down to a lower simulcast layer instead of freezing on a single high-quality layer.
- [ ] On a clean macOS install, starting screen share prompts for Screen & System Audio Recording access and Voxpery appears in that Privacy & Security list.
- [ ] On macOS, opening and closing the native share picker does not lower remote microphone audio; the same level continues without clicking Voxpery again.
- [ ] User B hears the screen-start cue only once for the screen video track.
- [ ] Sharing screen audio does not play a duplicate start cue.
- [ ] User B chooses `Stop watching`; the screen tile returns to `Stream available` and its screen video/audio publications unsubscribe for that viewer.
- [ ] User A's normal microphone audio continues while User B is not watching the stream.
- [ ] User B mutes or lowers the screen-share volume; only screen-share audio changes and User A's normal microphone audio remains audible.
- [ ] Per-user microphone volume stays within 0-200% and screen-share volume stays within 0-100%; repeated mute/unmute and boundary transitions do not cut out, clip, or change the selected output device.
- [ ] With stream audio muted at 0%, changing User Volume through 0/25/100/200% never unmutes the stream; with User Volume at 0%, changing Stream Volume through 0/25/100% never changes microphone playback.
- [ ] Voice and stream volume independence survives stop/watch, reconnect, reload, and desktop relaunch, including users with duplicate display names.
- [ ] User B chooses `Watch stream` again and screen video/audio return without replaying the publisher start cue.
- [ ] Minimizing or hiding User B's Voxpery window pauses incoming camera and watched screen video/audio traffic while microphone audio continues; restoring the window resumes only explicitly watched media without replaying start cues.
- [ ] User A repeatedly enters and leaves fullscreen on the local screen preview; capture stays live, no green/frozen frame appears, and User B's remote stream does not restart.
- [ ] User A stops screen share; User B hears the screen-stop cue once.
- [ ] User A leaves while sharing; User B hears the leave cue without an additional screen-stop cue.

## 5. Noise Suppression

Complete `docs/VOICE_SUPPRESSION_SMOKE_TEST.md` when this release touches audio processing, CSP, service workers, build output, or production deployment config.

Minimum quick check for other voice releases:

- [ ] Noise suppression is `On`.
- [ ] Normal speech remains intelligible.
- [ ] Keyboard, mouse, fan, breath, and clap transients do not consistently transmit as speech.
- [ ] Production diagnostics, when enabled, report `rnnoiseStatus: "ready"` for releases that touch suppression or production CSP.

## 6. Mobile Layout

- [ ] Voice bar fits narrow mobile width without horizontal overflow.
- [ ] Long channel names remain on one ellipsized header line; the composer shows attach, one expression picker entry point, and send without wrapping.
- [ ] Message actions open from one compact overflow menu and remain reachable without covering author or timestamp text.
- [ ] Camera and screen tiles do not overlap the composer, bottom voice bar, or member sheet.
- [ ] The mobile camera preview exposes a reachable front/rear switch only when a second camera is available.
- [ ] Remote media hide/show controls are reachable on mobile.
- [ ] Member sheet can be opened and closed while in voice.
- [ ] On a real Android or iOS browser, two-way microphone audio remains continuous while 3-5 users are connected; diagnostics report the mobile 48 kbps mono Opus profile and UI interaction or scrolling does not freeze direct remote playback.

## 7. Sign-off

- [ ] Web voice path passed.
- [ ] Desktop voice path passed when applicable.
- [ ] Mobile voice layout passed when applicable.
- [ ] Any skipped item has a reason recorded in the release notes or PR.
