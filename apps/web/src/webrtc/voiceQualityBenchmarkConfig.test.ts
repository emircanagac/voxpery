import { describe, expect, it } from 'vitest'
import {
  offThresholdFromOn,
  onThresholdFromSlider,
  thresholdByPreset,
} from './sensitivityThreshold'
import {
  getVoiceInputProfileConfig,
  getVoiceSuppressionTuning,
  shouldUseAggressiveVoiceIsolation,
} from './voiceInputProfile'
import { evaluateVoiceGateFrame } from './voiceGate'

const SAMPLE_RATE = 48_000
const FFT_SIZE = 256

function dbFromSlider(slider: number): number {
  return Math.round(20 * Math.log10(onThresholdFromSlider(slider)))
}

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

describe('voice quality benchmark configuration', () => {
  it('keeps the Balanced benchmark preset on the documented -58 dB balanced cleanup path', () => {
    const slider = thresholdByPreset('normal')
    const config = getVoiceInputProfileConfig('isolation')

    expect(slider).toBe(42)
    expect(dbFromSlider(slider)).toBe(-58)
    expect(config).toMatchObject({
      profile: 'isolation',
      voiceMode: 'voice_activity',
      noiseSuppressionEnabled: true,
      speakingPreset: 'normal',
      speakingThreshold: slider,
    })
    expect(getVoiceSuppressionTuning(config.profile, config.speakingThreshold, config.noiseSuppressionEnabled)).toBe('balanced')
    expect(shouldUseAggressiveVoiceIsolation(config.profile, config.noiseSuppressionEnabled)).toBe(true)
  })

  it('keeps the Noisy room benchmark preset on the documented -40 dB high cleanup path', () => {
    const slider = thresholdByPreset('noisy')

    expect(slider).toBe(60)
    expect(dbFromSlider(slider)).toBe(-40)
    expect(getVoiceSuppressionTuning('isolation', slider, true)).toBe('high')
    expect(shouldUseAggressiveVoiceIsolation('isolation', true)).toBe(true)
  })

  it('keeps Studio out of the benchmark isolation path', () => {
    const config = getVoiceInputProfileConfig('studio')

    expect(config.noiseSuppressionEnabled).toBe(false)
    expect(getVoiceSuppressionTuning(config.profile, config.speakingThreshold, config.noiseSuppressionEnabled)).toBe('off')
    expect(shouldUseAggressiveVoiceIsolation(config.profile, true)).toBe(false)
  })

  it('opens for speech but stays closed for benchmark noise bursts in Noisy room mode', () => {
    const noisySlider = thresholdByPreset('noisy')
    const onThr = onThresholdFromSlider(noisySlider)
    const offThr = offThresholdFromOn(onThr)
    const speechFrame = buildFrequencyFrame({ speechDb: -28, highNoiseDb: -68, lowNoiseDb: -84 })
    const noiseFrame = buildFrequencyFrame({ speechDb: -42, highNoiseDb: -37, lowNoiseDb: -76 })

    let result = evaluateVoiceGateFrame({
      rms: onThr * 1.4,
      frequencyData: noiseFrame,
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      onThr,
      offThr,
      noiseSuppressionEnabled: true,
      aggressiveIsolation: true,
      speaking: false,
      openFrames: 0,
      belowFrames: 0,
      smoothedRms: 0,
    })

    expect(result.speechFrame.noiseDominant).toBe(true)
    expect(result.speaking).toBe(false)
    expect(result.openFrames).toBe(0)

    for (let frameIndex = 0; frameIndex < result.openFramesRequired; frameIndex += 1) {
      result = evaluateVoiceGateFrame({
        rms: onThr * 1.7,
        frequencyData: speechFrame,
        sampleRate: SAMPLE_RATE,
        fftSize: FFT_SIZE,
        onThr,
        offThr,
        noiseSuppressionEnabled: true,
        aggressiveIsolation: true,
        speaking: result.speaking,
        openFrames: result.openFrames,
        belowFrames: result.belowFrames,
        smoothedRms: result.smoothedRms,
      })
    }

    expect(result.openFramesRequired).toBe(3)
    expect(result.speaking).toBe(true)
  })
})
