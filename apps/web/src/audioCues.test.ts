import { describe, expect, it } from 'vitest'
import {
  getPreferredVoiceAudioContextOptions,
  VOICE_AUDIO_SAMPLE_RATE,
  VOICE_CUE_TONES,
  type VoiceCueKind,
} from './audioCues'

const cueKinds = Object.keys(VOICE_CUE_TONES) as VoiceCueKind[]

function signature(kind: VoiceCueKind) {
  return JSON.stringify(VOICE_CUE_TONES[kind].map((tone) => ({
    from: tone.from,
    to: tone.to ?? tone.from,
    offset: tone.offsetSec ?? 0,
    duration: tone.durationSec,
    type: tone.type ?? 'triangle',
  })))
}

describe('voice cue catalog', () => {
  it('uses the 48 kHz sample rate required by the shared RNNoise pipeline', () => {
    expect(VOICE_AUDIO_SAMPLE_RATE).toBe(48_000)
    expect(getPreferredVoiceAudioContextOptions()).toEqual({ sampleRate: 48_000 })
  })

  it('gives every voice and media event a distinct sound profile', () => {
    const signatures = cueKinds.map(signature)
    expect(new Set(signatures).size).toBe(cueKinds.length)
  })

  it('keeps camera cues percussive while screen-share cues use a sustained chord', () => {
    const cameraStart = VOICE_CUE_TONES['camera-start']
    const screenStart = VOICE_CUE_TONES['screen-start']

    expect(Math.min(...cameraStart.map((tone) => tone.from))).toBeGreaterThan(1000)
    expect(Math.max(...cameraStart.map((tone) => tone.durationSec))).toBeLessThan(0.04)
    expect(Math.max(...screenStart.map((tone) => tone.from))).toBeLessThan(1000)
    expect(screenStart.length).toBeGreaterThan(cameraStart.length)
    expect(screenStart.filter((tone) => (tone.offsetSec ?? 0) === 0)).toHaveLength(2)
    expect(Math.max(...screenStart.map((tone) => tone.durationSec))).toBeGreaterThanOrEqual(0.2)
  })

  it('uses separate start and stop confirmations for camera and screen share', () => {
    expect(signature('camera-start')).not.toBe(signature('camera-stop'))
    expect(signature('screen-start')).not.toBe(signature('screen-stop'))
  })
})
