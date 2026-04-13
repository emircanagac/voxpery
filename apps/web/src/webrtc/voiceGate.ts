export interface SpeechFrameScore {
  score: number
  clicky: boolean
}

export interface VoiceGateFrameInput {
  rms: number
  frequencyData: Float32Array
  sampleRate: number
  fftSize: number
  onThr: number
  offThr: number
  noiseSuppressionEnabled: boolean
  aggressiveIsolation: boolean
  speaking: boolean
  openFrames: number
  belowFrames: number
  smoothedRms: number
}

export interface VoiceGateFrameResult {
  speaking: boolean
  openFrames: number
  belowFrames: number
  smoothedRms: number
  speechFrame: SpeechFrameScore
  openFramesRequired: number
  holdFrames: number
  effectiveOffThr: number
}

export function getBandAverageDb(
  frequencyData: Float32Array,
  sampleRate: number,
  fftSize: number,
  minHz: number,
  maxHz: number,
): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || fftSize <= 0 || maxHz <= minHz) return -100
  const nyquist = sampleRate / 2
  const clampedMin = Math.max(0, Math.min(minHz, nyquist))
  const clampedMax = Math.max(clampedMin, Math.min(maxHz, nyquist))
  const binWidth = sampleRate / fftSize
  const start = Math.max(0, Math.floor(clampedMin / binWidth))
  const end = Math.min(frequencyData.length - 1, Math.ceil(clampedMax / binWidth))
  let sum = 0
  let count = 0
  for (let i = start; i <= end; i++) {
    const value = frequencyData[i]
    if (!Number.isFinite(value)) continue
    sum += value
    count++
  }
  return count > 0 ? sum / count : -100
}

export function getSpeechFrameScore(
  frequencyData: Float32Array,
  sampleRate: number,
  fftSize: number,
): SpeechFrameScore {
  const presenceDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 220, 1400)
  const speechBodyDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 180, 2200)
  const upperSpeechDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 1600, 3200)
  const highNoiseDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 2800, 7200)
  const lowNoiseDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 0, 140)

  const score = Math.max(
    presenceDb - highNoiseDb,
    speechBodyDb - highNoiseDb + 0.8,
    upperSpeechDb - highNoiseDb - 0.6,
  )
  const clicky =
    highNoiseDb > presenceDb + 3.2
    && highNoiseDb > speechBodyDb + 4.2
    && lowNoiseDb < speechBodyDb - 6
  return { score, clicky }
}

export function evaluateVoiceGateFrame(input: VoiceGateFrameInput): VoiceGateFrameResult {
  const {
    rms,
    frequencyData,
    sampleRate,
    fftSize,
    onThr,
    offThr,
    noiseSuppressionEnabled,
    aggressiveIsolation,
    speaking,
    openFrames,
    belowFrames,
    smoothedRms,
  } = input

  const speechFrame = getSpeechFrameScore(frequencyData, sampleRate, fftSize)
  const speechLike = aggressiveIsolation
    ? speechFrame.score >= -1.4 && !speechFrame.clicky
    : speechFrame.score >= -2.6
  const openFramesRequired = aggressiveIsolation ? 2 : 1
  const holdFrames = aggressiveIsolation ? 8 : noiseSuppressionEnabled ? 9 : 7
  const smoothAlpha = aggressiveIsolation ? 0.945 : 0.955
  const effectiveOffThr = Math.max(
    offThr,
    onThr * (aggressiveIsolation ? 0.36 : noiseSuppressionEnabled ? 0.3 : 0.24),
  )
  const nextSmoothedRms = smoothAlpha * smoothedRms + (1 - smoothAlpha) * rms
  const strongOnset = rms >= onThr * (aggressiveIsolation ? 1.35 : 1.12)
  const shouldOpen = (rms >= onThr && speechLike) || (strongOnset && !speechFrame.clicky)

  if (shouldOpen) {
    const nextOpenFrames = openFrames + 1
    if (speaking || nextOpenFrames < openFramesRequired) {
      return {
        speaking,
        openFrames: nextOpenFrames,
        belowFrames: 0,
        smoothedRms: nextSmoothedRms,
        speechFrame,
        openFramesRequired,
        holdFrames,
        effectiveOffThr,
      }
    }
    return {
      speaking: true,
      openFrames: nextOpenFrames,
      belowFrames: 0,
      smoothedRms: nextSmoothedRms,
      speechFrame,
      openFramesRequired,
      holdFrames,
      effectiveOffThr,
    }
  }

  if (!speaking) {
    return {
      speaking: false,
      openFrames: 0,
      belowFrames: 0,
      smoothedRms: nextSmoothedRms,
      speechFrame,
      openFramesRequired,
      holdFrames,
      effectiveOffThr,
    }
  }

  // Once speech is already open, prefer continuity over overreacting to a
  // single frame that looks "clicky". This avoids chopping syllables mid-word.
  if (nextSmoothedRms >= effectiveOffThr) {
    return {
      speaking: true,
      openFrames: 0,
      belowFrames: 0,
      smoothedRms: nextSmoothedRms,
      speechFrame,
      openFramesRequired,
      holdFrames,
      effectiveOffThr,
    }
  }

  const nextBelowFrames = belowFrames + 1
  if (nextBelowFrames >= holdFrames) {
    return {
      speaking: false,
      openFrames: 0,
      belowFrames: 0,
      smoothedRms: nextSmoothedRms,
      speechFrame,
      openFramesRequired,
      holdFrames,
      effectiveOffThr,
    }
  }

  return {
    speaking: true,
    openFrames: 0,
    belowFrames: nextBelowFrames,
    smoothedRms: nextSmoothedRms,
    speechFrame,
    openFramesRequired,
    holdFrames,
    effectiveOffThr,
  }
}
