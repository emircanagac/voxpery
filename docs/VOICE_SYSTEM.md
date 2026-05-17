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
                           VAD gate (optional)
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
VAD gate (optional, voice_activity mode)
    |
LiveKit LocalAudioTrack
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
  - `Balanced` is the recommended default
  - `Noisy room` and stricter custom thresholds trend more aggressive for keyboard and room noise
- **Why RNNoise?**
  - Browser native `noiseSuppression` is too weak for noisy backgrounds
  - Krisp required LiveKit Cloud (self-hosted setups can't use it)
  - RNNoise is open-source, battle-tested (Jitsi, WebRTC-based apps), works self-hosted

### Voice Activity Detection (VAD)

Two modes:

1. **Voice Activity**: Mic auto-mutes when RMS below threshold (Discord-like)
   - Analyser reads RMS from the post-suppression signal (`post-denoise`, `post-floor-suppression`, `pre-volume`)
   - If above `onThreshold`, enable track; below `offThreshold` for enough held frames, disable
   - Fast attack + slower release + hysteresis keep speaking feedback responsive without flicker during short pauses
   - Suppression-enabled mode requires consecutive speech-like frames before opening the gate, and aggressive isolation rejects noise-dominant frames such as keyboard clicks, mouse clicks, and breath-heavy broadband noise
2. **Push-to-Talk**: Manual control via keyboard (default: `V` key)

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
<audio> element (volume 0.0-1.0) + GainNode (> 100%)
    |
AudioContext analyser (speaking indicator)
    |
Speaker
```

- **Output volume**: Global 1-100% + per-peer 0-200%
- **Amplification >100%**: Routed through WebAudio GainNode (gain > 1.0)
- **Deafen**: Sets `audio.muted = true` on all remote elements
- **Stop watching screen**: Hiding a remote screen share removes its screen-share audio track from playback while keeping the peer's normal microphone audio active.

## Screen Sharing

### Resolutions & Bitrates

| Preset        | Resolution | FPS | Bitrate (Mbps) | Use Case         |
|---------------|------------|-----|----------------|------------------|
| 720p 30fps    | 1280x720   | 30  | 2.5            | Default          |
| 720p 60fps    | 1280x720   | 60  | 4.0            | Gaming           |
| 1080p 30fps   | 1920x1080  | 30  | 5.0            | Presentations    |
| 1080p 60fps   | 1920x1080  | 60  | 8.0            | High-motion video|

### Implementation

```typescript
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 60 } },
  audio: true  // Screen share audio (e.g., YouTube video)
})
await room.localParticipant.publishTrack(videoTrack, {
  source: Track.Source.ScreenShare,
  videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
  simulcast: false  // Full quality, no layering
})
```

### Content Hints

- **Screen share video**: `contentHint = 'detail'` (preserves text sharpness)
- **Camera video**: `contentHint = 'motion'` (optimizes for movement)

### Remote Viewing Controls

- Remote camera and screen-share tiles can be hidden per viewer without leaving the voice channel.
- Hidden media stays as a compact placeholder with a `Show` action so the user can resume watching.
- Hidden preferences are local to the current voice session and reset after leaving, refreshing, or switching voice channels.
- Hiding a screen share also mutes that screen-share audio track; the participant's microphone audio continues normally.

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

### Mic or camera permission denied on desktop

1. Open User Settings -> Voice & Audio.
2. Click `Open settings` when microphone access is blocked, then allow Voxpery or desktop apps to use the microphone in OS privacy settings.
3. For camera denial, open the OS camera privacy settings, allow Voxpery or desktop apps to use the camera, then retry the camera toggle.
4. Restart Voxpery if the OS requires a restart before WebView permissions refresh.
5. Return to Voxpery and click `Retry mic access` or retry the camera action.

### Voice quality diagnostics

The active call bar shows a compact voice quality indicator while connected. The indicator combines a colored Wi-Fi icon with the current ping so users can understand call health at a glance. The visible chip color follows the visible ping value, while internal diagnostics can still classify the call as good, fair, poor, or measuring from ping, packet loss, and jitter.

- Poor internal quality means latency, packet loss, or jitter crossed the diagnostic threshold.
- Reconnecting state shows a short warning and keeps the user in the channel while LiveKit/WebSocket state resyncs.
- Poor internal quality does not show a proactive toast on its own; the compact indicator should stay calm unless the room is reconnecting.
- Missing LiveKit configuration returns `FEATURE_DISABLED` from the token endpoint so the client can show a clear "voice service unavailable" message instead of a generic join failure.

When debugging a production voice report, capture:

1. The call bar ping color and visible ping.
2. Whether the room was connected, connecting, or reconnecting.
3. Enable temporary diagnostics with `localStorage.setItem("voxperyVoiceDiagnostics", "1")`, reload, then inspect `window.__VOXPERY_VOICE_DIAGNOSTICS__` from DevTools after joining voice; it should show `rnnoiseStatus: "ready"`, the active profile, suppression tuning, and whether aggressive isolation is active.
4. Whether the user recently changed microphone, camera, VPN, firewall, or network.

### Voice cues

- Join and leave cues are intentionally different so members can identify someone entering or leaving without watching the channel list.
- Join uses a short rising three-note motif.
- Leave uses a lower descending two-note motif.
- Remote camera and screen-share starts use their own short cues so members can tell when someone begins broadcasting media.
- Existing remote media does not play a start cue when joining a channel; cues only play for media that starts while the user is already present.
- Mute, unmute, deafen, and undeafen keep shorter local-only cues.

### Echo or feedback

- **Browser echo cancellation**: Enabled by default (`echoCancellation: true`)
- If echo persists: user needs headphones (speaker output feeding back into mic)

## Performance

- **Latency**: 50-150ms typical (P2P via SFU)
- **Bandwidth**: ~50 kbps per audio stream (Opus codec)
- **CPU**: Minimal (SFU does forwarding, not transcoding)
- **Scalability**: Tested up to 20 concurrent users per room on 2-core VPS
