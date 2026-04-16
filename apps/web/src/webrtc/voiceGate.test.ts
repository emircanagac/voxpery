import { describe, expect, it } from 'vitest'
import { evaluateVoiceGateFrame } from './voiceGate'

const SAMPLE_RATE = 48_000
const FFT_SIZE = 256

function buildFrequencyFrame({
  speechDb,
  highNoiseDb,
  lowNoiseDb,
}: {
  speechDb: number
  highNoiseDb: number
  lowNoiseDb: number
}): Float32Array {
  const bins = new Float32Array(FFT_SIZE / 2).fill(-96)
  const binWidth = SAMPLE_RATE / FFT_SIZE
  const setBand = (minHz: number, maxHz: number, value: number) => {
    const start = Math.max(0, Math.floor(minHz / binWidth))
    const end = Math.min(bins.length - 1, Math.ceil(maxHz / binWidth))
    for (let i = start; i <= end; i++) bins[i] = value
  }

  setBand(180, 3200, speechDb)
  setBand(2800, 7200, highNoiseDb)
  setBand(0, 140, lowNoiseDb)
  return bins
}

describe('evaluateVoiceGateFrame', () => {
  it('opens immediately for non-aggressive isolation when speech is above threshold', () => {
    const result = evaluateVoiceGateFrame({
      rms: 0.024,
      frequencyData: buildFrequencyFrame({ speechDb: -28, highNoiseDb: -70, lowNoiseDb: -84 }),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      onThr: 0.01,
      offThr: 0.0014,
      noiseSuppressionEnabled: true,
      aggressiveIsolation: false,
      speaking: false,
      openFrames: 0,
      belowFrames: 0,
      smoothedRms: 0,
    })

    expect(result.openFramesRequired).toBe(1)
    expect(result.speaking).toBe(true)
  })

  it('requires two consecutive frames for aggressive isolation before opening', () => {
    const frame = buildFrequencyFrame({ speechDb: -30, highNoiseDb: -68, lowNoiseDb: -82 })
    const first = evaluateVoiceGateFrame({
      rms: 0.021,
      frequencyData: frame,
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      onThr: 0.01,
      offThr: 0.0014,
      noiseSuppressionEnabled: true,
      aggressiveIsolation: true,
      speaking: false,
      openFrames: 0,
      belowFrames: 0,
      smoothedRms: 0,
    })
    expect(first.openFramesRequired).toBe(2)
    expect(first.speaking).toBe(false)
    expect(first.openFrames).toBe(1)

    const second = evaluateVoiceGateFrame({
      rms: 0.021,
      frequencyData: frame,
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      onThr: 0.01,
      offThr: 0.0014,
      noiseSuppressionEnabled: true,
      aggressiveIsolation: true,
      speaking: first.speaking,
      openFrames: first.openFrames,
      belowFrames: first.belowFrames,
      smoothedRms: first.smoothedRms,
    })
    expect(second.speaking).toBe(true)
  })

  it('closes after hold frames are exhausted when signal remains below off threshold', () => {
    const result = evaluateVoiceGateFrame({
      rms: 0.000001,
      frequencyData: buildFrequencyFrame({ speechDb: -88, highNoiseDb: -88, lowNoiseDb: -88 }),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      onThr: 0.01,
      offThr: 0.0014,
      noiseSuppressionEnabled: true,
      aggressiveIsolation: false,
      speaking: true,
      openFrames: 0,
      belowFrames: 8,
      smoothedRms: 0.000001,
    })

    expect(result.holdFrames).toBe(9)
    expect(result.speaking).toBe(false)
  })

  it('keeps gate closed on clicky non-speech frames near threshold', () => {
    const result = evaluateVoiceGateFrame({
      rms: 0.0102,
      frequencyData: buildFrequencyFrame({ speechDb: -48, highNoiseDb: -26, lowNoiseDb: -70 }),
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      onThr: 0.01,
      offThr: 0.0014,
      noiseSuppressionEnabled: true,
      aggressiveIsolation: true,
      speaking: false,
      openFrames: 0,
      belowFrames: 0,
      smoothedRms: 0,
    })

    expect(result.speaking).toBe(false)
  })
})
