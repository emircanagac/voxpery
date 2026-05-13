# Voice Suppression Smoke Test

Use this smoke test before production releases that touch voice, WebRTC, LiveKit, service workers, build output, or audio settings. The goal is to confirm that local Docker and production candidates use the same suppression path and that RNNoise is actually active.

## Required Setup

- Use two users in the same voice channel.
- Test in Chromium-based browser first, then desktop if the release includes desktop artifacts.
- Use the same microphone device for local Docker and production.
- Set Voice Settings:
  - Noise suppression: `On`
  - Input tuning preset: `Noisy room`
  - Activation mode: `Voice Activity`

## Runtime Diagnostic Gate

Before joining voice on production, confirm the web response CSP allows WebAssembly:

```bash
curl -I https://voxpery.com/
```

Required header detail:

```text
content-security-policy: ... script-src 'self' 'wasm-unsafe-eval' ...
```

After joining voice, open DevTools on the sender and run:

```js
window.__VOXPERY_VOICE_DIAGNOSTICS__
```

Required result:

```js
{
  rnnoiseStatus: "ready",
  noiseSuppressionEnabled: true,
  voiceInputProfile: "isolation" /* or "custom" */,
  suppressionTuning: "high",
  aggressiveIsolation: true
}
```

Fail the release candidate if:

- The production CSP does not include `'wasm-unsafe-eval'` in `script-src`.
- `rnnoiseStatus` is `failed`, `loading` for more than a few seconds, or missing.
- `noiseSuppressionEnabled` is not `true`.
- `suppressionTuning` is not `high` after selecting `Noisy room`.
- `aggressiveIsolation` is not `true` while suppression is on.

## Audio Behavior Gate

Run each sound while the receiver listens:

| Input | Expected result |
| --- | --- |
| Normal speech | Clear and intelligible, without chopped syllables. |
| Single clap near the mic | Not transmitted, or only a heavily attenuated transient. |
| Keyboard typing | Not transmitted as continuous speech. |
| Mouse clicks | Not transmitted as continuous speech. |
| Fan or steady room noise | Does not open the voice activity gate by itself. |
| Short breath near mic | Does not keep the gate open after the breath ends. |

Fail the release candidate if normal speech is hard to understand, or if clap/keyboard/fan noise consistently reaches the receiver like normal voice.

## Local vs Production Parity

Run the same steps on:

1. Local Docker build.
2. Production candidate.

The production candidate should not be meaningfully worse than local Docker with the same device and settings. If production differs, capture:

- Browser + version.
- Microphone device name.
- `window.__VOXPERY_VOICE_DIAGNOSTICS__`.
- Whether the request for `/assets/rnnoise-worklet.js` came from network or service worker cache.
- Whether the test used browser, installed PWA, or desktop app.

## Notes

- RNNoise readiness is release-critical. If the worklet cannot become ready quickly, Voxpery records `rnnoiseStatus: "failed"` and falls back intentionally instead of silently pretending that suppression is active.
- The mic test and real voice call must both pass, but the real call is authoritative for release sign-off.
