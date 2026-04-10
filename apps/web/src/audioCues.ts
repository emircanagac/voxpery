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

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

export function getOrCreateAudioContext(ref: { current: AudioContext | null }): AudioContext | null {
  const AudioCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext
  if (!AudioCtor) return null
  if (!ref.current) ref.current = new AudioCtor()
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
