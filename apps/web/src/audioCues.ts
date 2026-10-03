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
  // Room events use a three-note melody; controls have their own rhythm and register.
  join: [
    { from: 523.25, durationSec: 0.13, peak: 0.022, type: 'triangle', overtoneGain: 0.05, filterHz: 1900 },
    { from: 659.25, offsetSec: 0.09, durationSec: 0.13, peak: 0.022, type: 'triangle', overtoneGain: 0.05, filterHz: 2100 },
    { from: 783.99, offsetSec: 0.18, durationSec: 0.18, peak: 0.024, type: 'sine', overtoneGain: 0.06, filterHz: 2400 },
  ],
  leave: [
    { from: 392, offsetSec: 0, durationSec: 0.12, peak: 0.026, type: 'sine', overtoneGain: 0.06, filterHz: 1400 },
    { from: 329.63, offsetSec: 0.09, durationSec: 0.12, peak: 0.025, type: 'sine', overtoneGain: 0.06, filterHz: 1200 },
    { from: 261.63, offsetSec: 0.18, durationSec: 0.17, peak: 0.024, type: 'sine', overtoneGain: 0.04, filterHz: 1000 },
  ],
  mute: [
    { from: 196, to: 164.81, durationSec: 0.1, peak: 0.048, type: 'triangle', overtoneGain: 0.08, filterHz: 950 },
  ],
  unmute: [
    { from: 196, to: 220, durationSec: 0.06, peak: 0.046, type: 'triangle', overtoneGain: 0.08, filterHz: 1000 },
    { from: 349.23, offsetSec: 0.085, durationSec: 0.085, peak: 0.046, type: 'triangle', overtoneGain: 0.08, filterHz: 1400 },
  ],
  deafen: [
    { from: 220, to: 196, durationSec: 0.1, peak: 0.05, type: 'triangle', overtoneGain: 0.08, filterHz: 1000 },
    { from: 196, to: 164.81, offsetSec: 0.145, durationSec: 0.12, peak: 0.049, type: 'triangle', overtoneGain: 0.08, filterHz: 850 },
  ],
  undeafen: [
    { from: 196, to: 261.63, durationSec: 0.1, peak: 0.049, type: 'triangle', overtoneGain: 0.08, filterHz: 1100 },
    { from: 293.66, to: 349.23, offsetSec: 0.145, durationSec: 0.14, peak: 0.048, type: 'triangle', overtoneGain: 0.08, filterHz: 1400 },
  ],
  // Camera confirmations are bright overlapping bells, not room-join melodies.
  'camera-start': [
    { from: 1046.5, durationSec: 0.075, peak: 0.022, type: 'sine', overtoneGain: 0.12, filterHz: 3600 },
    { from: 1567.98, offsetSec: 0.045, durationSec: 0.13, peak: 0.022, type: 'sine', overtoneGain: 0.05, filterHz: 3800 },
  ],
  'camera-stop': [
    { from: 1567.98, to: 1046.5, durationSec: 0.09, peak: 0.021, type: 'sine', overtoneGain: 0.06, filterHz: 3200 },
    { from: 783.99, offsetSec: 0.07, durationSec: 0.1, peak: 0.021, type: 'sine', overtoneGain: 0.04, filterHz: 2400 },
  ],
  // Sharing opens/closes a soft chord with a separate confirmation pulse.
  'screen-start': [
    { from: 329.63, durationSec: 0.25, peak: 0.014, type: 'triangle', overtoneGain: 0.04, filterHz: 1600 },
    { from: 392, durationSec: 0.25, peak: 0.014, type: 'sine', overtoneGain: 0.04, filterHz: 1800 },
    { from: 523.25, durationSec: 0.25, peak: 0.014, type: 'sine', overtoneGain: 0.04, filterHz: 2000 },
    { from: 1046.5, offsetSec: 0.27, durationSec: 0.085, peak: 0.018, type: 'sine', overtoneGain: 0.04, filterHz: 3000 },
  ],
  'screen-stop': [
    { from: 329.63, to: 164.81, durationSec: 0.2, peak: 0.015, type: 'triangle', overtoneGain: 0.02, filterHz: 1200 },
    { from: 392, to: 196, durationSec: 0.2, peak: 0.015, type: 'sine', overtoneGain: 0.02, filterHz: 1400 },
    { from: 523.25, to: 261.63, durationSec: 0.2, peak: 0.015, type: 'sine', overtoneGain: 0.02, filterHz: 1600 },
    { from: 196, offsetSec: 0.225, durationSec: 0.08, peak: 0.025, type: 'triangle', overtoneGain: 0.02, filterHz: 750 },
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
    const attack = Math.min(0.012, tone.durationSec * 0.2)
    const releaseStart = Math.max(startAt + attack, endAt - Math.max(0.028, tone.durationSec * 0.55))
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

    mainOsc.onended = () => {
      mainOsc.disconnect()
      overtoneOsc.disconnect()
      overtoneMix.disconnect()
      mix.disconnect()
      filter.disconnect()
    }

    mainOsc.start(startAt)
    overtoneOsc.start(startAt)
    mainOsc.stop(endAt)
    overtoneOsc.stop(endAt)
  })
}

export function playVoiceCueStack(ctx: AudioContext, kind: VoiceCueKind): void {
  playCueStack(ctx, [...VOICE_CUE_TONES[kind]])
}
