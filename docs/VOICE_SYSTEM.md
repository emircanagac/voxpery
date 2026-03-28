# Voice System

Voxpery uses **LiveKit SFU** for voice, screen sharing, and camera. Audio is processed client-side with noise suppression, voice activity detection (VAD), and gain control.

## Architecture

```
Microphone → getUserMedia → AudioContext pipeline → LiveKit Room → SFU → Remote peers
                                    ↓
                           Noise suppression
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
5. Frontend publishes mic track → LiveKit forwards to all room participants
6. Frontend subscribes to all remote tracks automatically

### Room Events

- `TrackSubscribed`: Remote peer published audio/video → add to `remoteStreams`
- `TrackUnsubscribed`: Remote peer unpublished → remove from `remoteStreams`
- `ParticipantConnected`: New user joined → play join sound
- `ParticipantDisconnected`: User left → play leave sound, cleanup
- `Reconnecting`/`Reconnected`: Network blip → re-subscribe tracks, refresh stats
- `Disconnected`: Lost connection → backend WS resync handles re-join

## Audio Pipeline

### Input Chain (Microphone → LiveKit)

```
Raw mic track
    ↓
getUserMedia({ noiseSuppression: false })  ← Browser NS disabled
    ↓
AudioContext.createMediaStreamSource
    ↓
RNNoise ScriptProcessorNode (ML-based denoiser)
    ↓
GainNode (input volume: 0.0–2.0 from settings)
    ↓
VAD gate (optional, voice_activity mode)
    ↓
LiveKit LocalAudioTrack
    ↓
Room.localParticipant.publishTrack
```

### Noise Suppression

- **RNNoise WASM**: ML-based denoiser (Mozilla-grade, open source)
  - Implemented via `@shiguredo/rnnoise-wasm` v2025.1.5 (maintained by Shiguredo, Japanese Jitsi infrastructure company)
  - Processes 480-sample frames (~10ms at 48kHz) with ring-buffer bridging to browser's 4096-sample callbacks
  - Lazy-loaded on first enable (~4.8 MB WASM, 3.1 MB gzipped) → separate chunk in Vite build
  - Removes keyboard clicks, fan noise, background hum while preserving voice clarity
  - Toggle: Live on/off in Voice Settings (no voice channel re-join required)
- **Why RNNoise?**
  - Browser native `noiseSuppression` is too weak for noisy backgrounds
  - Krisp required LiveKit Cloud (self-hosted setups can't use it)
  - RNNoise is open-source, battle-tested (Jitsi, WebRTC-based apps), works self-hosted

### Voice Activity Detection (VAD)

Two modes:

1. **Voice Activity**: Mic auto-mutes when RMS below threshold (Discord-like)
   - Analyser reads RMS from raw mic track
   - If above `onThreshold`, enable track; below `offThreshold` for N frames, disable
   - Hysteresis + hold frames prevent flicker during speech pauses
2. **Push-to-Talk**: Manual control via keyboard (default: `V` key)

### Sensitivity Threshold

- **Range**: 0–100 (slider in Voice Settings)
- **Presets**:
  - `Quiet` (16): −36dB — sensitive but avoids false positives in quiet rooms
  - `Normal` (25): −29dB — **default**, balanced for standard speaking volume
  - `Noisy` (55): −15dB — only loud direct speech passes in noisy backgrounds
- **Mapping**: Exponential curve to natural dB range
  - `0` → `0.001` (-60 dB, very sensitive to whispers)
  - `25` → `0.064` (-29 dB, normal conversation)
  - `100` → `0.561` (-5 dB, only loud speech)
- **Hysteresis**: `offThreshold = onThreshold × 0.1` (10× lower) to prevent rapid on/off flicker during speech pauses

### Output Chain (Remote Audio)

```
LiveKit RemoteTrack
    ↓
MediaStream
    ↓
<audio> element (volume 0.0–1.0) + GainNode (> 100%)
    ↓
AudioContext analyser (speaking indicator)
    ↓
Speaker
```

- **Output volume**: Global 1–100% + per-peer 0–200%
- **Amplification >100%**: Routed through WebAudio GainNode (gain > 1.0)
- **Deafen**: Sets `audio.muted = true` on all remote elements

## Screen Sharing

### Resolutions & Bitrates

| Preset        | Resolution | FPS | Bitrate (Mbps) | Use Case         |
|---------------|------------|-----|----------------|------------------|
| 720p 30fps    | 1280×720   | 30  | 2.5            | Default          |
| 720p 60fps    | 1280×720   | 60  | 4.0            | Gaming           |
| 1080p 30fps   | 1920×1080  | 30  | 5.0            | Presentations    |
| 1080p 60fps   | 1920×1080  | 60  | 8.0            | High-motion video|

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

## Camera

- **Resolution**: 1920×1080 @ 30fps max (configurable)
- **Bitrate**: 3 Mbps (adaptive)
- Published to `Track.Source.Camera`

## Troubleshooting

### No audio from remote peers

1. Check `audio.muted` is `false` (deafen off)
2. Verify `audio.srcObject` is set
3. Check browser console for `play()` errors (autoplay policy)
4. Ensure LiveKit SFU is reachable (check Room state)

### Audio cutting out (5+ users)

- **Fixed**: AudioContext pool (v1.1) — remote monitors share one context
- If still occurring: check browser console for `AudioContext` errors

### Voice not syncing after reconnect

- **Fixed**: WS reconnect resync (v1.1) — `JoinVoice` re-sent on WS reconnect
- If persisting: check backend logs for voice_sessions cleanup race

### Mic not detected

1. Check browser permissions (allow microphone)
2. Verify device in OS settings
3. Try another browser (Firefox, Chrome, Edge)
4. Linux desktop: ensure `xdg-desktop-portal` + one backend (`xdg-desktop-portal-gtk` or `xdg-desktop-portal-kde`) and `pipewire` are installed/running, then restart Voxpery.

### Echo or feedback

- **Browser echo cancellation**: Enabled by default (`echoCancellation: true`)
- If echo persists: user needs headphones (speaker output feeding back into mic)

## Performance

- **Latency**: 50–150ms typical (P2P via SFU)
- **Bandwidth**: ~50 kbps per audio stream (Opus codec)
- **CPU**: Minimal (SFU does forwarding, not transcoding)
- **Scalability**: Tested up to 20 concurrent users per room on 2-core VPS
