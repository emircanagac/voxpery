import { describe, expect, it, vi } from 'vitest'
import {
  getPreferredVoiceAudioContextOptions,
  playCueStack,
  playVoiceCueStack,
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

  it('separates microphone taps, room melodies, camera bells, and sharing chords', () => {
    const cameraStart = VOICE_CUE_TONES['camera-start']
    const screenStart = VOICE_CUE_TONES['screen-start']

    expect(VOICE_CUE_TONES.mute).toHaveLength(1)
    expect(VOICE_CUE_TONES.unmute).toHaveLength(2)
    expect(VOICE_CUE_TONES.join).toHaveLength(3)
    expect(VOICE_CUE_TONES.leave).toHaveLength(3)
    expect(Math.max(...VOICE_CUE_TONES.unmute.map((tone) => tone.from))).toBeLessThan(400)
    expect(Math.min(...cameraStart.map((tone) => tone.from))).toBeGreaterThan(1000)
    expect(cameraStart.every((tone) => tone.type === 'sine')).toBe(true)
    expect(screenStart.filter((tone) => (tone.offsetSec ?? 0) === 0)).toHaveLength(3)
    expect(screenStart.at(-1)?.offsetSec).toBeGreaterThan(0.25)
    expect(Math.max(...screenStart.map((tone) => tone.durationSec))).toBeGreaterThanOrEqual(0.2)
    expect(VOICE_CUE_TONES.deafen[1].offsetSec).toBeGreaterThan(0.12)
    expect(VOICE_CUE_TONES.undeafen[1].offsetSec).toBeGreaterThan(0.12)
  })

  it('uses ascending join notes and descending leave notes', () => {
    expect(VOICE_CUE_TONES.join.map((tone) => tone.from)).toEqual([523.25, 659.25, 783.99])
    expect(VOICE_CUE_TONES.leave.map((tone) => tone.from)).toEqual([392, 329.63, 261.63])
  })

  it('keeps confirmations brief, bounded, and free of harsh square or sawtooth tones', () => {
    for (const kind of cueKinds) {
      const tones = VOICE_CUE_TONES[kind]
      const duration = Math.max(...tones.map((tone) => (tone.offsetSec ?? 0) + tone.durationSec))
      expect(duration).toBeLessThanOrEqual(0.4)
      for (const tone of tones) {
        expect(tone.durationSec).toBeGreaterThan(0)
        expect(tone.peak).toBeGreaterThan(0)
        const isAudioControl = ['mute', 'unmute', 'deafen', 'undeafen'].includes(kind)
        expect(tone.peak).toBeLessThanOrEqual(isAudioControl ? 0.05 : 0.03)
        expect(['sine', 'triangle']).toContain(tone.type)
      }
    }
  })

  it('makes audio-control confirmations audible without relying on deep bass', () => {
    for (const kind of ['mute', 'unmute', 'deafen', 'undeafen'] as const) {
      for (const tone of VOICE_CUE_TONES[kind]) {
        expect(tone.peak).toBeGreaterThanOrEqual(0.046)
        expect(Math.min(tone.from, tone.to ?? tone.from)).toBeGreaterThanOrEqual(164)
        expect(tone.overtoneGain).toBeGreaterThanOrEqual(0.08)
        expect(tone.filterHz).toBeGreaterThanOrEqual(850)
      }
    }
  })

  it('uses separate start and stop confirmations for camera and screen share', () => {
    expect(signature('camera-start')).not.toBe(signature('camera-stop'))
    expect(signature('screen-start')).not.toBe(signature('screen-stop'))
  })
})

function mockAudioContext() {
  const param = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  })
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  const gains: Array<ReturnType<typeof node> & { gain: ReturnType<typeof param> }> = []
  const oscillators: Array<ReturnType<typeof node> & {
    frequency: ReturnType<typeof param>
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    onended: (() => void) | null
  }> = []
  const filters: Array<ReturnType<typeof node> & {
    frequency: ReturnType<typeof param>
    Q: ReturnType<typeof param>
  }> = []
  const ctx = {
    currentTime: 10,
    destination: {},
    createGain: vi.fn(() => {
      const gain = { ...node(), gain: param() }
      gains.push(gain)
      return gain
    }),
    createOscillator: vi.fn(() => {
      const oscillator = { ...node(), frequency: param(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
      oscillators.push(oscillator)
      return oscillator
    }),
    createBiquadFilter: vi.fn(() => {
      const filter = { ...node(), frequency: param(), Q: param() }
      filters.push(filter)
      return filter
    }),
  }
  return { ctx: ctx as unknown as AudioContext, gains, oscillators, filters }
}

describe('cue synthesis', () => {
  it.each(cueKinds)('schedules %s envelopes inside their tone and disconnects completed nodes', (kind) => {
    const { ctx, gains, oscillators, filters } = mockAudioContext()
    playVoiceCueStack(ctx, kind)
    expect(oscillators).toHaveLength(VOICE_CUE_TONES[kind].length * 2)

    VOICE_CUE_TONES[kind].forEach((tone, index) => {
      const start = ctx.currentTime + (tone.offsetSec ?? 0)
      const end = start + tone.durationSec
      const gain = gains[index * 2].gain
      const attackEnd = gain.exponentialRampToValueAtTime.mock.calls[0][1]
      const releaseStart = gain.setValueAtTime.mock.calls[1][1]
      expect(attackEnd).toBeGreaterThan(start)
      expect(releaseStart).toBeGreaterThanOrEqual(attackEnd)
      expect(releaseStart).toBeLessThan(end)
      expect(gain.exponentialRampToValueAtTime.mock.calls[1][1]).toBe(end)
      expect(filters[index].connect).toHaveBeenCalledWith(ctx.destination)
      expect(oscillators[index * 2].start).toHaveBeenCalledWith(start)
      expect(oscillators[index * 2 + 1].stop).toHaveBeenCalledWith(end)

      oscillators[index * 2].onended?.()
      expect(oscillators[index * 2].disconnect).toHaveBeenCalledOnce()
      expect(oscillators[index * 2 + 1].disconnect).toHaveBeenCalledOnce()
      expect(gains[index * 2].disconnect).toHaveBeenCalledOnce()
      expect(gains[index * 2 + 1].disconnect).toHaveBeenCalledOnce()
      expect(filters[index].disconnect).toHaveBeenCalledOnce()
    })
  })

  it.each([0.002, 0.026])('does not schedule release before attack for a %s-second tone', (durationSec) => {
    const { ctx, gains } = mockAudioContext()
    playCueStack(ctx, [{ from: 440, durationSec }])
    const gain = gains[0].gain
    const attackEnd = gain.exponentialRampToValueAtTime.mock.calls[0][1]
    const releaseStart = gain.setValueAtTime.mock.calls[1][1]
    expect(attackEnd).toBeGreaterThanOrEqual(ctx.currentTime)
    expect(releaseStart).toBeGreaterThanOrEqual(attackEnd)
    expect(releaseStart).toBeLessThan(ctx.currentTime + durationSec)
  })
})
