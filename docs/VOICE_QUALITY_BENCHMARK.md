# Voice Quality Benchmark

Use this benchmark before changing voice codec, bitrate, capture constraints, noise suppression, echo cancellation, automatic gain, input gain, VAD, or LiveKit publish options.

The benchmark exists to compare Voxpery against a known-good reference call, usually Discord, with the same people, devices, room, and network. Do not tune voice from memory alone.

## Goals

- Keep normal speech intelligible and natural.
- Avoid clipped syllables, pumping, metallic artifacts, and unstable loudness.
- Suppress keyboard, mouse, fan, room hum, breath, and clap transients without making speech dull.
- Keep voice activity responsive without opening on non-speech noise.
- Confirm Voxpery is not meaningfully worse than the reference call under the same conditions.

## Required Setup

- Two testers in the same physical or network environment where possible.
- The same microphone, browser or desktop device, headset, input volume, and operating system settings for both Voxpery and the reference app.
- One sender and one receiver. The receiver records notes and, if possible, a short local audio capture from the call output.
- Voxpery Voice Settings:
  - Noise suppression: `On`
  - Input tuning preset: `Balanced`, then repeat with `Noisy room`
  - Activation mode: `Voice Activity`
  - Input volume: `100%`
  - Output volume: `100%`

## Baseline Run

Run the same script in the reference app first, then in Voxpery.

1. Sender reads the speech sample at normal volume.
2. Sender reads the speech sample quietly.
3. Sender reads the speech sample while typing continuously.
4. Sender clicks the mouse ten times while silent.
5. Sender claps once near the microphone while silent.
6. Sender breathes near the microphone, then stays silent for three seconds.
7. Sender turns on a steady fan or room-noise source, then speaks normally.
8. Sender pauses mid-sentence for one second, then continues.

Use the same distance from the microphone for every run.

## Speech Sample

Read this sample exactly so runs are comparable:

```text
Voxpery voice test. Today we are checking clarity, background noise, keyboard clicks, short pauses, and whether quiet speech still sounds natural.
```

## Receiver Scorecard

Score each item from `1` to `5`.

| Category | 1 | 3 | 5 |
| --- | --- | --- | --- |
| Clarity | Hard to understand | Understandable with effort | Clear and easy |
| Naturalness | Robotic or metallic | Some processing artifacts | Natural voice |
| Loudness stability | Pumps or jumps | Mostly stable | Stable |
| Syllable preservation | Words are clipped | Occasional clipping | No clipping |
| Noise rejection | Noise sounds like speech | Noise leaks sometimes | Noise stays suppressed |
| VAD behavior | Opens/closes incorrectly | Mostly usable | Responsive and calm |

Record separate scores for:

- Reference app, normal room.
- Voxpery `Balanced`, normal room.
- Voxpery `Noisy room`, noisy room.

## Runtime Diagnostics

Before the Voxpery run, enable diagnostics on the sender:

```js
localStorage.setItem("voxperyVoiceDiagnostics", "1")
location.reload()
```

After joining voice, capture:

```js
window.__VOXPERY_VOICE_DIAGNOSTICS__
```

You can also open User Settings -> Voice & Audio and click `Copy diagnostics` to copy the same JSON snapshot into the benchmark notes.

Required diagnostic fields:

- `rnnoiseStatus` is `ready` when suppression is on.
- `noiseSuppressionEnabled` is `true`.
- `speakingPreset` is `normal` for the `Balanced` run and `noisy` for the `Noisy room` run.
- `speakingThreshold` is `42` for the `Balanced` run and `60` for the `Noisy room` run.
- `speakingThresholdDb` is `-58` for the `Balanced` run and `-40` for the `Noisy room` run.
- `suppressionTuning` is `balanced` for the `Balanced` run.
- `suppressionTuning` is `high` for the `Noisy room` run.
- `aggressiveIsolation` is `true` for noisy-room isolation.

Also capture the call bar ping color and visible ping.

After the benchmark:

```js
localStorage.removeItem("voxperyVoiceDiagnostics")
location.reload()
```

## Pass Criteria

A voice-quality change is acceptable only when:

- Voxpery normal speech clarity is at least `4/5`.
- Voxpery naturalness is at least `4/5`.
- Voxpery has no repeated clipped syllables during normal speech.
- Voxpery does not consistently open voice activity for fan, mouse, keyboard, clap, or breath while silent.
- Voxpery is not more than one point worse than the reference app in clarity or naturalness.
- `Noisy room` improves noise rejection without making normal speech hard to understand.

Fail or revert the change when:

- The receiver cannot understand normal speech.
- The gate regularly cuts off word starts or endings.
- Background noise transmits like normal voice.
- RNNoise diagnostics are missing, failed, or stale.
- Local Docker and production candidate behave meaningfully differently with the same device and settings.

## Experiment Workflow

Use small PRs for each tuning change.

1. Record the baseline scores before editing.
2. Change only one family of settings per PR:
   - capture constraints
   - RNNoise/suppression tuning
   - VAD/gate thresholds
   - input gain/compression
   - LiveKit publish options
3. Run unit tests for changed voice helpers.
4. Run `docs/VOICE_SUPPRESSION_SMOKE_TEST.md`.
5. Run this benchmark against the same reference call.
6. Put before/after scores and diagnostic fields in the PR description.

## PR Result Template

```md
## Voice Quality Benchmark

- Reference app:
- Device / OS / browser:
- Voxpery environment:
- Voxpery settings:
- Diagnostics:

| Run | Clarity | Naturalness | Loudness | Syllables | Noise rejection | VAD |
| --- | --- | --- | --- | --- | --- | --- |
| Reference |  |  |  |  |  |  |
| Voxpery Balanced |  |  |  |  |  |  |
| Voxpery Noisy room |  |  |  |  |  |  |

Decision: `GO` / `NO-GO`
Notes:
```
