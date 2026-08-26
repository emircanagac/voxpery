# Voice System

Voxpery uses **LiveKit SFU** for voice, screen sharing, and camera. Audio is processed client-side with layered cleanup, voice activity detection (VAD), and gain control.

## Architecture

```
Microphone -> getUserMedia -> AudioContext pipeline -> LiveKit Room -> SFU -> Remote peers
                                    |
                           High-pass cleanup
                           RNNoise denoiser
                           Speech / transient cleanup
                           Low-level noise taming
                           VAD analyser tap
                           Input gain
                           VAD monitoring (sender stays live)
                           Sensitivity threshold
```

## LiveKit Integration

### Why LiveKit?

- **SFU topology**: Server forwards media without decoding (low latency, high scalability)
- **Adaptive bitrate**: Simulcast layers, dynacast (publishes only consumed layers)
- **Built-in signaling**: No custom WebRTC signaling; LiveKit SDK handles negotiation
- **Track management**: Easy screen share, camera, multiple audio sources

### Connection Flow

1. User clicks voice channel
2. Frontend requests LiveKit token: `GET /api/webrtc/livekit-token?channel_id=...`
3. Backend mints JWT with `room`, `identity`, `canPublish`, `canSubscribe`
4. Frontend creates `Room`, connects with token
5. Frontend publishes mic track -> LiveKit forwards to all room participants
6. Frontend subscribes to all remote tracks automatically

### Server-side Voice Revocation

- LiveKit tokens are only minted after the backend verifies `VIEW_SERVER` and `CONNECT_VOICE`.
- If a member is kicked, banned, disconnected by a moderator, or loses active voice permissions through role/channel overrides, the backend clears the runtime voice session and asks LiveKit to remove that participant from the room.
- This server-side removal is required because a modified client could ignore WebSocket leave events while keeping an already-established LiveKit media connection alive.
- If LiveKit is unavailable during revocation, Voxpery still clears local voice state and logs the LiveKit removal failure for operators.

### Room Events

- `TrackSubscribed`: Remote peer published audio/video -> add to `remoteStreams`
- `TrackUnsubscribed`: Remote peer unpublished -> remove from `remoteStreams`
- `ParticipantConnected`: New user joined -> play a distinct rising join cue
- `ParticipantDisconnected`: User left -> play a distinct descending leave cue, cleanup
- `Reconnecting`/`Reconnected`: Network blip -> re-subscribe tracks, refresh stats
- `Disconnected`: Lost connection -> backend WS resync handles re-join

## Audio Pipeline

### Input Chain (Microphone -> LiveKit)

```
Raw mic track
    |
getUserMedia({
  noiseSuppression: <On/Off from settings>,
  echoCancellation: true,
  autoGainControl: !noiseSuppression
})  <- Browser EC always on; browser NS is used as a light fallback layer
    |
AudioContext.createMediaStreamSource
    |
High-pass filter
    |
RNNoise AudioWorkletNode (ML-based denoiser)
    |
Speech / transient cleanup stage
    |
Low-level noise tamer (post-RNNoise floor shaping)
    |
VAD analyser tap (post-denoise + post-floor suppression, pre-volume)
    |
GainNode (input volume)
    |
Published-track health monitor
    |
LiveKit LocalAudioTrack (high-quality mono Opus with DTX + RED)
    |
Room.localParticipant.publishTrack
```

### Noise Suppression

- **RNNoise WASM**: ML-based denoiser (Mozilla-grade, open source)
  - Implemented via `@shiguredo/rnnoise-wasm` v2025.1.5 (maintained by Shiguredo, Japanese Jitsi infrastructure company)
  - Runs inside an `AudioWorkletNode` for low-latency realtime processing
  - Lazy-loaded on first enable (~4.8 MB WASM, 3.1 MB gzipped) -> separate chunk in Vite build
  - Removes keyboard clicks, fan noise, background hum while preserving voice clarity
  - While RNNoise is loading, the worklet briefly outputs silence instead of raw mic audio so startup cannot leak background noise before the denoiser is ready
  - Toggle: Live on/off in Voice Settings (no voice channel re-join required)
- **Simple user-facing model**
  - Voice Settings intentionally exposes only `Off` / `On`
  - When `On`, Voxpery automatically changes cleanup strength based on the current **Input sensitivity** threshold
  - This keeps `Custom` sensitivity values logically aligned with the actual environment instead of tying suppression strength to preset names only
  - `Custom` keeps the same isolation style as the default profile; only `Studio` intentionally disables the aggressive cleanup path
- **Threshold-based suppression tuning**
  - `-100 .. -53 dB` -> `balanced` cleanup
  - `-52 .. 0 dB` -> `high` cleanup
  - In practice:
    - quieter and everyday thresholds use the recommended balanced cleanup
    - noisier thresholds apply stronger cleanup for keyboard and room noise
- **High-pass cleanup**
  - A high-pass stage removes low rumble, desk vibration, plosive energy, and some breath boom before denoising
- **Low-level noise tamer**
  - A gentle post-RNNoise gain stage reduces very quiet residual noise between phrases without hard-gating speech
  - Helps with dip hiss, room hum, and lingering background texture while keeping speech natural
- **Post-suppression VAD tap**
  - The mic test monitor and local speaking indicator now read from the signal after residual floor attenuation
  - This keeps the glow and mic test closer to the audio Voxpery would actually send, so keyboard, mouse, and breath noise are less likely to appear as speech
- **Preset-aware DSP behavior**
  - With suppression enabled, Voxpery adjusts multiple stages together:
    - low-pass filtering for high-frequency keyboard/transient cleanup
    - click / transient attenuation
    - speech-presence shaping
    - compressor strength
    - residual noise floor attenuation
  - `Balanced` is the recommended default. It keeps a `110 Hz .. 7.6 kHz` post-denoise band, uses gentle `2.6:1` compression, and keeps detected speech above a `0.90` residual-floor gain so everyday voices retain body and upper detail.
  - `Noisy room` remains stronger without collapsing into a telephone-like voice band. It keeps a `145 Hz .. 5.6 kHz` band, uses bounded `4.8:1` compression, and keeps detected speech above a `0.82` residual-floor gain.
  - Spectral isolation and attack/recovery smoothing are profile-aware: `Balanced` recovers speech faster and attenuates it less, while `Noisy room` applies stronger isolation only to noise-dominant frames such as keyboard and fan fixtures.
  - Clean speech bypasses post-RNNoise floor and spectral attenuation in both presets. Quiet speech remains fully open in `Balanced`; `Noisy room` may apply bounded cleanup but must not mute or hard-gate it.
- **Microphone publish quality**
  - Firefox, Chromium, and desktop webviews use the same 48 kHz processing graph required by RNNoise. A zero-volume connection to the hardware destination keeps that graph rendering without playing the local microphone through the speakers.
  - Browser identity never bypasses noise suppression. If Web Audio is unavailable before publication, Voxpery uses the browser-native capture track; it does not replace a healthy processed sender based on a browser-local analyser reading.
  - Built-in input profiles are authoritative for activation mode and suppression, while explicit push-to-talk remains available through the custom profile.
  - The selected microphone track is published with LiveKit's high-quality mono Opus preset.
  - Mobile web/PWA clients use the resilient 48 kbps mono Opus preset. Desktop clients keep the 96 kbps preset; both retain RED and DTX so unstable mobile uplinks do not have to carry the desktop bitrate.
  - DTX remains enabled to avoid sending unnecessary silence, and RED remains enabled for packet-loss resilience.
  - Stereo is forced off for microphone audio so bitrate stays focused on voice clarity rather than duplicate channels.
  - If the raw capture track ends or the operating-system default input changes during a call, Voxpery re-captures the preferred/default device and atomically replaces the existing LiveKit sender track. The working publication remains in place until the replacement is ready.
- **Why RNNoise?**
  - Browser native `noiseSuppression` is too weak for noisy backgrounds
  - Krisp required LiveKit Cloud (self-hosted setups can't use it)
  - RNNoise is open-source, battle-tested (Jitsi, WebRTC-based apps), works self-hosted

### Voice Activity Detection (VAD)

Two modes:

1. **Voice Activity**: Mic pickup and speaking feedback follow the configured RMS threshold
   - Analyser reads RMS from the post-suppression signal (`post-denoise`, `post-floor-suppression`, `pre-volume`)
   - Threshold crossings update speaking state without replacing or restarting the published WebRTC sender track
   - Fast attack + slower release + hysteresis keep speaking feedback responsive without flicker during short pauses
   - Suppression-enabled mode requires consecutive speech-like frames before reporting speech, and aggressive isolation rejects noise-dominant frames such as keyboard clicks, mouse clicks, and breath-heavy broadband noise
   - Quiet transport is handled by the processed audio pipeline and Opus DTX. Manual mute, deafen, and push-to-talk remain the only controls that change the microphone's published state.
2. **Push-to-Talk**: Manual control via keyboard (default: `V` key)

### Microphone Mute Shortcut

- Users can assign a modifier-based shortcut from `Settings -> Voice & Audio`.
- On web, the shortcut works only while the Voxpery tab is focused, as required by browser security restrictions.
- In the desktop app, the same preference is registered through Tauri's global-shortcut plugin and works while Voxpery is minimized or in the tray.
- The shortcut dispatches through the same mute control used by the call bar, so microphone tracks, LiveKit state, realtime voice control state, and local cues stay synchronized.
- A shortcut must include `Ctrl/Cmd`, `Alt`, or `Shift`; unmodified keys are rejected to avoid interfering with typing and games.
- If a desktop registration conflicts with another application, Voxpery preserves the previous working shortcut and asks the user to choose another combination.

### Sensitivity Threshold

- **Range**: `-100 dB .. 0 dB` in the UI (`0..100` internal slider scale)
- **Presets**:
  - `Balanced` (`-58 dB`) - recommended default for everyday use
  - `Noisy room` (`-40 dB`) - stricter for louder environments with keyboard, mouse, fan, or breath noise
  - `Custom` - manual threshold control across the full `-100 .. 0 dB` range
- **Default preset**: `Balanced`
- **Mapping**:
  - UI shows a natural `-100 .. 0 dB` scale
  - internally the slider is stored as `0..100`, with each step representing roughly `1 dB`
  - `0` -> `-100 dB`
  - `42` -> `-58 dB` (`Balanced`)
  - `100` -> `0 dB`
- **Hysteresis**: `offThreshold = onThreshold * 0.14` to prevent rapid on/off flicker during speech pauses

### Output Chain (Remote Audio)

```
LiveKit RemoteTrack
    |
MediaStream
    |
Browser: per-source Web Audio gain/destination graph
Tauri/mobile: independent direct <audio> output per source
    |
Speaker
```

- **Output volume**: Global 1-100%, per-peer microphone 0-200%, and per-screen-share audio 0-100%.
- **Desktop-safe playback**: Tauri plays each remote microphone and watched screen-share track through its own direct media element. This avoids routing incoming audio through a WebView-specific `MediaStreamAudioDestination` bridge while preserving source-level mute, volume, output-device, and playback recovery controls.
- **Stable startup**: Output-device changes are serialized per media element, and an unchanged remote track has at most one pending playback start. Initial LiveKit subscription and mute-state events therefore cannot restart watched screen audio while the first playback promise settles.
- **Source-aware browser dynamics**: Browser microphone amplification keeps its peak limiter, while screen-share audio bypasses voice compression so music and game dynamics are preserved. Tauri and mobile web keep the more resilient direct media path.
- **Deafen**: Mutes remote microphone playback while leaving watched screen-share audio under its independent stream volume/mute controls
- **Immediate deafen**: Every active browser microphone bus is set to zero synchronously with the control click. Direct Tauri and mobile microphone elements are muted in the same pass, and newly subscribed microphone outputs start muted while deafened, closing reconnect and render/effect windows where voice could otherwise leak briefly.
- **Deafened speaking feedback**: Self-deafen and server-deafen suppress remote speaking rings in both the channel sidebar and voice stage. The underlying speaking state remains intact, so indicators resume immediately after undeafen without waiting for a new speaking event.
- **Watch screen share**: Screen-share video and shared audio remain unsubscribed until the viewer chooses `Watch stream`; `Stop watching` removes only those viewer subscriptions while the peer's normal microphone audio remains active.
- **Pre-join media presence**: Server members can see a camera icon and `LIVE` screen-share badge beside voice participants before joining the channel. These indicators use the server-broadcast voice control state and do not subscribe the viewer to media.

### Input and Output Device Selection

- New users and users who leave device selection on `Windows Default` follow the current system default microphone and speaker.
- Explicit microphone and speaker selections remain stored and are reused while those devices are available.
- If a stored custom device is unplugged, removed, or no longer exposed by the browser, Voxpery clears only that stale preference and silently retries with the system default.
- Device changes are reconciled during an active call. Existing custom inputs remain selected while available; a removed custom input or changed system default triggers a debounced capture rebuild.
- Permission failures, devices that are temporarily busy, and output-selection policy failures do not overwrite a valid custom preference.
- The same microphone fallback is used by call preflight, LiveKit capture, the microphone test, and the legacy WebRTC path.
- Mobile browsers use their hardware/browser AEC and noise suppression with a lightweight Web Audio gain path. They skip the desktop RNNoise analyser/refinement loop and play remote microphone tracks through the browser's direct media path, so capture and multiple remote playbacks do not compete for the mobile main thread.
- Desktop browsers also play remote microphone and watched screen audio directly at normal volume. The independent Web Audio voice gain path is created only for an explicit per-user voice level above 100%; screen audio remains direct and independently controlled from 0% to 100%.

## Screen Sharing

### Resolutions & Bitrates

| Preset        | Resolution | FPS | Bitrate (Mbps) | Use Case         |
|---------------|------------|-----|----------------|------------------|
| Auto          | 1080p      | 30/60 | 4-8          | Balanced selection by shared surface |
| Presentation  | 1080p      | 30  | 4.0            | Slides, docs, IDEs |
| Video         | 1080p      | 60  | 8.0            | Browser tabs, monitors, and video |
| Gaming        | 1080p      | 60  | 12.0           | Explicit high-motion mode |

### Implementation

```typescript
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 60, max: 60 } },
  systemAudio: 'include',
  audio: {
    restrictOwnAudio: true,
    suppressLocalAudioPlayback: false,
  } // Exclude Voxpery's own call audio while keeping the call audible locally
})
await room.localParticipant.publishTrack(videoTrack, {
  source: Track.Source.ScreenShare,
  screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
  videoCodec: supportsVP9() ? 'vp9' : 'vp8',
  scalabilityMode: supportsVP9() ? 'L3T3_KEY' : undefined,
  simulcast: !supportsVP9(),
  screenShareSimulcastLayers: supportsVP9()
    ? undefined
    : [screenShare360p30, screenShare720p60]
})
audioTrack.contentHint = 'music'
await room.localParticipant.publishTrack(audioTrack, {
  source: Track.Source.ScreenShareAudio,
  audioPreset: AudioPresets.musicHighQualityStereo, // 128 kbps Opus
  forceStereo: true,
  dtx: false,
  red: true,
})
```

Screen publishing uses VP9 SVC when supported and falls back to VP8 simulcast with 360p30 and 720p60 intermediate layers. Remote LiveKit video tracks are rendered through `RemoteVideoTrack.attach()` so adaptive stream can select a layer from the element's actual dimensions and visibility. Incompatible runtimes retain the VP8 path. The local preview uses a separate `MediaStream` wrapper around the capture tracks, so entering or leaving fullscreen never rebinds or restarts the published capture.

### Content Hints

- **Auto screen share**: Starts with a 1080p60 capture envelope, then reapplies the selected surface profile after `displaySurface` is known.
- **Presentation/window share**: `contentHint = 'detail'` at 1080p30 and `maintain-resolution` degradation to preserve text sharpness while limiting traffic.
- **Browser tab/video and Auto monitor share**: `contentHint = 'motion'` at 1080p60 with an 8 Mbps cap and `maintain-framerate` degradation.
- **Gaming share**: Explicit 1080p60 high-motion mode with a 12 Mbps cap for users who prefer quality over bandwidth.
- **Screen-share audio**: `contentHint = 'music'`, stereo 128 kbps Opus, continuous transmission (`dtx = false`), and RED packet-loss resilience preserve system, game, and music audio independently from the mono speech microphone profile.
- **Camera video**: `contentHint = 'motion'` (optimizes for movement). On mobile devices with more than one camera, the local preview exposes a front/rear switch that restarts the existing published LiveKit video track in place. Devices with only one available camera do not show the control.
- A share is not published without a live video track. A missing system/tab audio track is treated as an intentional silent share; capture or publication failures still surface as errors. System-audio availability is determined by the operating system, browser/runtime, selected share surface, and the picker audio option rather than the GPU vendor.
- Display capture requests selected-window audio for window shares, excludes Voxpery's own call playback and browser surface where supported, and lets the native picker expose broader system-audio capture only for surfaces where the runtime supports it. Voxpery never substitutes whole-system audio when selected-window audio is unavailable.
- Publishing is rollback-safe: if any selected screen track fails to publish, already-published tracks from that attempt are unpublished and the local capture is stopped.
- Opt-in voice diagnostics record requested and actual capture resolution/FPS, constraint application, screen-audio sample rate/channel count/content hint/publish profile, codec/scalability mode, simulcast state, outbound video resolution/FPS/bitrate/packet/quality-limitation samples, and actual screen-audio Opus bitrate/channel/packet samples without device identifiers.

### Remote Viewing Controls

- Remote camera tiles can be hidden per viewer without leaving the voice channel.
- A remote screen share appears first as a compact `Stream available` tile. `Watch stream` subscribes that viewer to both `ScreenShare` and `ScreenShareAudio`; `Stop watching` unsubscribes both while leaving microphone audio untouched.
- Viewer subscription state is local to the current voice session, survives visibility changes and LiveKit reconnects, and resets when the share ends, the participant disconnects, or the viewer leaves voice.
- Unwatched shares produce no incoming screen video or shared-audio traffic. Hiding Voxpery pauses watched screen video, while watched shared audio remains subscribed so background playback does not cut out.
- `User Volume` controls only the participant's `Track.Source.Microphone` audio from 0-200%. Values above 100% use a per-user Web Audio gain and limiter path instead of being clamped by `HTMLMediaElement.volume`.
- `Stream Volume` and stream mute control only `Track.Source.ScreenShareAudio` from 0-100%. Voice and stream values, mute restore values, and persisted keys are independent, so changing one source never unmutes or changes the other.
- Global output volume remains a top-level playback control for both sources without rewriting either per-source preference. Deafen suppresses remote microphone playback only; watched screen-share audio remains controlled by its independent stream volume and mute state.
- When the Voxpery window is hidden or minimized, camera and watched screen video subscriptions pause while microphone and explicitly watched screen-share audio continue. Video resumes when the app becomes visible, without replaying media-start cues.
- Returning from the native screen picker, restoring the app, or refocusing Voxpery reasserts the configured output device, volume, and remote playback without changing per-user volume settings.
- Existing remote microphone publications are hydrated by LiveKit as part of the room join, independent of participant join order, and remain subscribed in foreground and background. Selective rules then unsubscribe only unwatched screen shares and hidden video. Failed subscriptions are retried, missing subscribed tracks are reconciled after LiveKit reconnect, ended tracks are removed immediately, and replacement tracks supersede stale tracks from the same logical source.
- Speaking indicators monitor microphone tracks only; screen-share audio cannot incorrectly keep a participant marked as speaking.

### Voice Event Cues

- Join, leave, mute, deafen, camera, and screen-share events use one shared synthesized cue catalog across LiveKit and the legacy WebRTC fallback.
- Camera start and stop confirmations are local to the member changing their camera. Remote participants see camera state without receiving a channel-wide camera cue.
- Screen-share start and stop cues are heard by members already in the voice channel. Existing shares remain silent during initial room hydration, subscription resume, and local hide/show actions.
- Screen-share stop is suppressed when the publisher disconnects so the normal leave cue remains the single channel departure sound.
- Viewer watch and stop-watching actions are silent; channel-wide screen-share cues describe only publisher start and stop events.
- Camera confirmations use short high-frequency shutter-like clicks; screen-share confirmations use sustained digital chords so neither resembles voice join or leave cues, and all cues respect the existing notification-sounds preference.

## Camera

- **Resolution**: 1920x1080 @ 30fps max (configurable)
- **Bitrate**: 3 Mbps (adaptive)
- Published to `Track.Source.Camera`

## Troubleshooting

### No audio from remote peers

1. Check `audio.muted` is `false` (deafen off)
2. Verify `audio.srcObject` is set
3. Check browser console for `play()` errors (autoplay policy)
4. Ensure LiveKit SFU is reachable (check Room state)

### Audio cutting out (5+ users)

- **Fixed**: AudioContext pool (v1.1) - remote monitors share one context
- If still occurring: check browser console for `AudioContext` errors

### Voice not syncing after reconnect

- **Fixed**: WS reconnect resync (v1.1) - `JoinVoice` re-sent on WS reconnect
- If persisting: check backend logs for voice_sessions cleanup race

### Mic not detected

1. Check browser permissions (allow microphone)
2. Verify device in OS settings
3. Try another browser (Firefox, Chrome, Edge)
4. Linux desktop: ensure `xdg-desktop-portal` + one backend (`xdg-desktop-portal-gtk` or `xdg-desktop-portal-kde`) and `pipewire` are installed/running, then restart Voxpery.

### Mic, camera, or screen-recording permission denied on desktop

1. Open User Settings -> Voice & Audio.
2. Click `Open settings` when microphone access is blocked, then allow Voxpery or desktop apps to use the microphone in OS privacy settings.
3. For camera denial, open the OS camera privacy settings, allow Voxpery or desktop apps to use the camera, then retry the camera toggle.
4. On macOS, allow Voxpery under Privacy & Security -> Screen & System Audio Recording before retrying screen share.
5. Restart Voxpery if the OS requires a restart before WebView permissions refresh.
6. Return to Voxpery and click `Retry mic access`, retry the camera action, or start screen share again.

The macOS application bundle declares microphone, camera, screen-recording, and shared-audio usage descriptions. Its code-signing entitlements allow microphone and camera capture. These files are release-validated so a desktop build cannot silently lose its native permission registration.

### Voice quality diagnostics

The active call bar shows a compact voice quality indicator while connected. The indicator combines a colored Wi-Fi icon with the current ping so users can understand call health at a glance. The visible chip color follows the visible ping value, while internal diagnostics can still classify the call as good, fair, poor, or measuring from ping, packet loss, and jitter.

- Web and desktop use the same source policy: backend WebSocket RTT is the initial fallback, then the transport-selected ICE candidate-pair RTT becomes authoritative after a short stable sample window.
- Candidate-pair, nominated-pair, and RTCP RTT values are fallback tiers rather than a mixed sample pool. Stale samples and values from a previous voice channel are discarded; the UI shows a measuring state until a current source is available.

- Poor internal quality means latency, packet loss, or jitter crossed the diagnostic threshold.
- Reconnecting state shows a short warning and keeps the user in the channel while LiveKit/WebSocket state resyncs.
- Poor internal quality does not show a proactive toast on its own; the compact indicator should stay calm unless the room is reconnecting.
- Missing LiveKit configuration returns `FEATURE_DISABLED` from the token endpoint so the client can show a clear "voice service unavailable" message instead of a generic join failure.

When debugging a production voice report, capture:

1. The call bar ping color and visible ping.
2. Whether the room was connected, connecting, or reconnecting.
3. Enable temporary diagnostics with `localStorage.setItem("voxperyVoiceDiagnostics", "1")`, reload, then inspect `window.__VOXPERY_VOICE_DIAGNOSTICS__` from DevTools after joining voice; it should show `rnnoiseStatus: "ready"`, the active profile, suppression tuning, and whether aggressive isolation is active. During screen share, `screenShare` shows audio sample rate/channel count and the stereo music publish profile, `screenShareOutbound` shows actual video quality, and `screenShareAudioOutbound` shows actual Opus bitrate/channel/packet signals.
4. Whether the user recently changed microphone, camera, VPN, firewall, or network.

### Voice cues

- Join and leave cues are intentionally different so members can identify someone entering or leaving without watching the channel list.
- Join uses a short rising three-note motif.
- Leave uses a lower descending two-note motif.
- Camera start and stop cues are local confirmations for the member controlling their camera.
- Remote screen-share start and stop use their own cues so members can tell when a broadcast begins or ends.
- Existing remote screen shares do not play a start cue when joining a channel; cues only play for shares that start while the user is already present.
- Hiding, showing, pausing, or resubscribing remote media does not replay broadcast cues.
- Mute, unmute, deafen, and undeafen keep shorter local-only cues.

### Echo or feedback

- **Browser echo cancellation**: Enabled by default (`echoCancellation: true`)
- If echo persists: user needs headphones (speaker output feeding back into mic)

## Performance

- **Latency**: 50-150ms typical (P2P via SFU)
- **Bandwidth**: ~50 kbps per audio stream (Opus codec)
- **CPU**: Minimal (SFU does forwarding, not transcoding)
- **Scalability**: Tested up to 20 concurrent users per room on 2-core VPS

## Release Validation

Run `docs/VOICE_RELEASE_SMOKE_TEST.md` for every release candidate that changes voice, LiveKit/WebRTC, camera, screen sharing, audio settings, service worker caching, desktop runtime, or build output.

Run `docs/VOICE_SUPPRESSION_SMOKE_TEST.md` in addition when a release changes suppression, CSP, service workers, build output, or production deployment config. The suppression smoke test is intentionally stricter because RNNoise readiness and production CSP parity are release-critical for voice quality.

Run `docs/VOICE_QUALITY_BENCHMARK.md` before changing voice codec, bitrate, capture constraints, suppression tuning, VAD/gate thresholds, input gain, or LiveKit publish options. The benchmark compares Voxpery against a reference call such as Discord with the same device, room, and network so voice tuning is based on repeatable observations instead of memory.
