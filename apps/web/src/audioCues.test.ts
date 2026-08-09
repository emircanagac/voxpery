import { describe, expect, it } from 'vitest'
import { VOICE_CUE_TONES, type VoiceCueKind } from './audioCues'

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
  it('gives every voice and media event a distinct sound profile', () => {
    const signatures = cueKinds.map(signature)
    expect(new Set(signatures).size).toBe(cueKinds.length)
  })

  it('keeps camera cues short and high while screen-share cues use a lower sweep', () => {
    const cameraStart = VOICE_CUE_TONES['camera-start']
    const screenStart = VOICE_CUE_TONES['screen-start']

    expect(Math.min(...cameraStart.map((tone) => tone.from))).toBeGreaterThan(1000)
    expect(Math.max(...cameraStart.map((tone) => tone.durationSec))).toBeLessThan(0.08)
    expect(Math.max(...screenStart.map((tone) => tone.from))).toBeLessThan(1000)
    expect(screenStart.length).toBeGreaterThan(cameraStart.length)
  })

  it('uses separate start and stop confirmations for camera and screen share', () => {
    expect(signature('camera-start')).not.toBe(signature('camera-stop'))
    expect(signature('screen-start')).not.toBe(signature('screen-stop'))
  })
})
