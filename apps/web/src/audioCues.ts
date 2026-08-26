export type CueTone = {
  from: number
  to?: number
  offsetSec?: number
  durationSec: number
  peak?: number
  type?: OscillatorType
  overtoneGain?: number
  filterHz?: number
  q?: number
}

export type VoiceCueKind =
  | 'join'
  | 'leave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'camera-start'
  | 'camera-stop'
  | 'screen-start'
  | 'screen-stop'

export const VOICE_CUE_TONES: Readonly<Record<VoiceCueKind, readonly CueTone[]>> = {
  join: [
    { from: 430, to: 520, durationSec: 0.085, peak: 0.02, type: 'triangle', overtoneGain: 0.12, filterHz: 1800, q: 0.9 },
    { from: 640, to: 780, offsetSec: 0.07, durationSec: 0.1, peak: 0.023, type: 'triangle', overtoneGain: 0.14, filterHz: 2400, q: 0.9 },
    { from: 960, to: 1160, offsetSec: 0.155, durationSec: 0.13, peak: 0.026, type: 'sine', overtoneGain: 0.08, filterHz: 3200, q: 0.75 },
  ],
  leave: [
    { from: 900, to: 650, durationSec: 0.13, peak: 0.032, type: 'triangle', overtoneGain: 0.12, filterHz: 2400, q: 0.9 },
    { from: 520, to: 320, offsetSec: 0.105, durationSec: 0.18, peak: 0.028, type: 'sine', overtoneGain: 0.06, filterHz: 1300, q: 0.78 },
  ],
  mute: [
    { from: 520, to: 410, durationSec: 0.085, peak: 0.02, type: 'triangle', overtoneGain: 0.14, filterHz: 1700, q: 1.1 },
  ],
  unmute: [
    { from: 390, to: 560, durationSec: 0.09, peak: 0.022, type: 'triangle', overtoneGain: 0.18, filterHz: 2200, q: 0.9 },
  ],
  deafen: [
    { from: 480, to: 360, durationSec: 0.08, peak: 0.019, type: 'triangle', overtoneGain: 0.12, filterHz: 1600, q: 1.2 },
    { from: 300, to: 230, offsetSec: 0.07, durationSec: 0.105, peak: 0.016, type: 'sine', overtoneGain: 0.06, filterHz: 1100, q: 0.8 },
  ],
  undeafen: [
    { from: 270, to: 340, durationSec: 0.08, peak: 0.018, type: 'sine', overtoneGain: 0.08, filterHz: 1400, q: 0.8 },
    { from: 430, to: 640, offsetSec: 0.065, durationSec: 0.11, peak: 0.024, type: 'triangle', overtoneGain: 0.2, filterHz: 2400, q: 0.9 },
  ],
  'camera-start': [
    { from: 3100, to: 980, durationSec: 0.026, peak: 0.016, type: 'square', overtoneGain: 0.02, filterHz: 5200, q: 1.4 },
    { from: 3600, to: 1250, offsetSec: 0.052, durationSec: 0.03, peak: 0.014, type: 'sawtooth', overtoneGain: 0.015, filterHz: 5800, q: 1.2 },
  ],
  'camera-stop': [
    { from: 1700, to: 420, durationSec: 0.032, peak: 0.015, type: 'square', overtoneGain: 0.02, filterHz: 3600, q: 1.2 },
    { from: 900, to: 260, offsetSec: 0.048, durationSec: 0.038, peak: 0.012, type: 'triangle', overtoneGain: 0.02, filterHz: 2200, q: 1 },
  ],
  'screen-start': [
    { from: 180, durationSec: 0.22, peak: 0.017, type: 'square', overtoneGain: 0.025, filterHz: 900, q: 0.72 },
    { from: 360, to: 540, durationSec: 0.22, peak: 0.019, type: 'triangle', overtoneGain: 0.08, filterHz: 1800, q: 0.75 },
    { from: 980, offsetSec: 0.2, durationSec: 0.08, peak: 0.016, type: 'sine', overtoneGain: 0.03, filterHz: 3000, q: 0.7 },
  ],
  'screen-stop': [
    { from: 540, to: 180, durationSec: 0.19, peak: 0.018, type: 'square', overtoneGain: 0.025, filterHz: 1600, q: 0.8 },
    { from: 270, to: 135, durationSec: 0.19, peak: 0.015, type: 'sine', overtoneGain: 0.035, filterHz: 900, q: 0.75 },
  ],
}

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

export const VOICE_AUDIO_SAMPLE_RATE = 48_000

export function getPreferredVoiceAudioContextOptions(): AudioContextOptions {
  return { sampleRate: VOICE_AUDIO_SAMPLE_RATE }
}

function createVoiceAudioContext(AudioCtor: typeof AudioContext): AudioContext {
  try {
    return new AudioCtor(getPreferredVoiceAudioContextOptions())
  } catch {
    return new AudioCtor()
  }
}

export function getOrCreateAudioContext(ref: { current: AudioContext | null }): AudioContext | null {
  const AudioCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext
  if (!AudioCtor) return null
  if (!ref.current || ref.current.state === 'closed') {
    ref.current = createVoiceAudioContext(AudioCtor)
  }
  const ctx = ref.current
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {})
  }
  return ctx
}

export function playCueStack(ctx: AudioContext, tones: CueTone[]): void {
  const startBase = ctx.currentTime

  tones.forEach((tone) => {
    const startAt = startBase + (tone.offsetSec ?? 0)
    const endAt = startAt + tone.durationSec
    const attack = Math.min(0.02, Math.max(0.006, tone.durationSec * 0.24))
    const releaseStart = endAt - Math.max(0.028, tone.durationSec * 0.42)
    const peak = tone.peak ?? 0.03
    const filterHz = tone.filterHz ?? Math.max(1200, tone.from * 2.8)
    const q = tone.q ?? 0.7
    const overtoneGain = tone.overtoneGain ?? 0.28
    const baseType = tone.type ?? 'triangle'

    const mix = ctx.createGain()
    mix.gain.setValueAtTime(0.0001, startAt)
    mix.gain.exponentialRampToValueAtTime(peak, startAt + attack)
    mix.gain.setValueAtTime(peak * 0.9, releaseStart)
    mix.gain.exponentialRampToValueAtTime(0.0001, endAt)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(filterHz, startAt)
    filter.Q.setValueAtTime(q, startAt)

    const mainOsc = ctx.createOscillator()
    mainOsc.type = baseType
    mainOsc.frequency.setValueAtTime(tone.from, startAt)
    if (typeof tone.to === 'number' && Number.isFinite(tone.to) && tone.to > 0) {
      mainOsc.frequency.exponentialRampToValueAtTime(tone.to, endAt)
    }

    const overtoneOsc = ctx.createOscillator()
    overtoneOsc.type = baseType === 'sine' ? 'triangle' : 'sine'
    overtoneOsc.frequency.setValueAtTime(tone.from * 2, startAt)
    if (typeof tone.to === 'number' && Number.isFinite(tone.to) && tone.to > 0) {
      overtoneOsc.frequency.exponentialRampToValueAtTime(tone.to * 2, endAt)
    }
    const overtoneMix = ctx.createGain()
    overtoneMix.gain.setValueAtTime(overtoneGain, startAt)

    mainOsc.connect(mix)
    overtoneOsc.connect(overtoneMix)
    overtoneMix.connect(mix)
    mix.connect(filter)
    filter.connect(ctx.destination)

    mainOsc.start(startAt)
    overtoneOsc.start(startAt)
    mainOsc.stop(endAt)
    overtoneOsc.stop(endAt)
  })
}

export function playVoiceCueStack(ctx: AudioContext, kind: VoiceCueKind): void {
  playCueStack(ctx, [...VOICE_CUE_TONES[kind]])
}
