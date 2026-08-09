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
- [ ] Mute/unmute changes local mic state and does not disconnect the room.
- [ ] The configured mute shortcut toggles the microphone while the web tab is focused.
- [ ] A new/default user joins with the operating system's current default microphone and speaker.
- [ ] A valid custom microphone and speaker remain selected after reload and voice rejoin.
- [ ] After a selected custom microphone or speaker is disconnected, the next capture/playback attempt silently uses the system default and Voice Settings shows `Windows Default`.
- [ ] While already joined, unplugging the active microphone or changing the operating-system default input recovers capture without leaving/rejoining and without removing the existing LiveKit microphone publication first.
- [ ] In desktop builds, the configured mute shortcut also works while Voxpery is unfocused, minimized, or running in the tray.
- [ ] On a clean macOS install, the first voice join prompts for microphone access and Voxpery appears in Privacy & Security -> Microphone after the decision.
- [ ] Rebinding or clearing the mute shortcut takes effect immediately; a conflicting desktop shortcut shows an error without losing the previous working binding.
- [ ] Deafen stops remote audio playback and restores it when disabled.
- [ ] User B leaves and User A hears a leave cue that is clearly different from the join cue.
- [ ] Rejoining the same channel does not leave duplicate participants or stale voice controls.

## 2. Reconnect and Revocation

- [ ] Refresh the web app while joined to voice; the app either restores/resyncs cleanly or leaves with an understandable state.
- [ ] Briefly interrupt WebSocket connectivity if possible; voice state resyncs after reconnect.
- [ ] Kick, ban, moderator disconnect, or removing `Connect to Voice` removes the affected user from the active room promptly.
- [ ] The removed user cannot keep listening through an existing LiveKit session.

## 3. Camera

- [ ] User A starts camera; User B sees the camera tile.
- [ ] User A hears the local camera-start cue; User B does not hear a channel-wide camera cue.
- [ ] User B hides the remote camera tile and can show it again.
- [ ] User A hears the local camera-stop cue; User B does not hear a channel-wide camera cue.
- [ ] Starting camera again plays one local camera-start cue for User A.
- [ ] Switching from voice to a text channel and back keeps camera UI stable.

## 4. Screen Share

- [ ] `Presentation` profile publishes at the UI-described 1080p30 behavior.
- [ ] `Video` profile publishes at the UI-described 1080p60 behavior.
- [ ] `Gaming` profile publishes at the UI-described 1080p60 behavior with the higher bitrate profile.
- [ ] `Auto` chooses a balanced profile by shared surface: monitor/browser -> video, window/unknown -> presentation.
- [ ] Monitor/game and browser/video shares stay motion-first under load: frame pacing remains smooth before sharpness is preserved.
- [ ] A VP9-capable Chromium/WebView2 publisher reports `codec: vp9` and `scalabilityMode: L3T3_KEY`; a fallback runtime reports `codec: vp8`.
- [ ] Resizing and fullscreening User B's remote share tile upgrades the received adaptive layer without restarting the share.
- [ ] User A starts screen share; User B sees the screen tile.
- [ ] Sharing a supported browser tab/system-audio source publishes both `ScreenShare` and `ScreenShareAudio`; User B hears the shared audio independently from User A's microphone.
- [ ] Sharing a source/platform that provides no audio still publishes video and shows User A one non-fatal `Sharing without audio` notice.
- [ ] With opt-in diagnostics enabled, requested and actual capture resolution/FPS, audio capture/publication, simulcast, outbound bitrate/FPS, packet loss, and quality limitation reason are present without device identifiers.
- [ ] Under constrained bandwidth, screen share remains watchable by stepping down to a lower simulcast layer instead of freezing on a single high-quality layer.
- [ ] On a clean macOS install, starting screen share prompts for Screen & System Audio Recording access and Voxpery appears in that Privacy & Security list.
- [ ] On macOS, opening and closing the native share picker does not lower remote microphone audio; the same level continues without clicking Voxpery again.
- [ ] User B hears the screen-start cue only once for the screen video track.
- [ ] Sharing screen audio does not play a duplicate start cue.
- [ ] User B hides the screen share; the screen tile collapses and its screen video/audio publications stop for that viewer.
- [ ] While hidden by User B, the remote screen video and screen-share audio publications are unsubscribed; selecting `Show` restores them without replaying the start cue.
- [ ] User A's normal microphone audio continues while the screen share is hidden.
- [ ] User B mutes or lowers the screen-share volume; only screen-share audio changes and User A's normal microphone audio remains audible.
- [ ] User B shows the screen share again and audio behavior returns with the visible media.
- [ ] Minimizing or hiding User B's Voxpery window pauses incoming camera/screen video traffic while microphone and screen-share audio continue; restoring the window resumes video without replaying start cues.
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
- [ ] Camera and screen tiles do not overlap the composer, bottom voice bar, or member sheet.
- [ ] Remote media hide/show controls are reachable on mobile.
- [ ] Member sheet can be opened and closed while in voice.

## 7. Sign-off

- [ ] Web voice path passed.
- [ ] Desktop voice path passed when applicable.
- [ ] Mobile voice layout passed when applicable.
- [ ] Any skipped item has a reason recorded in the release notes or PR.
