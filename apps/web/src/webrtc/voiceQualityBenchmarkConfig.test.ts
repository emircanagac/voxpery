import { beforeEach, describe, expect, it } from 'vitest'
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
import {
  buildSuppressionConfig,
  buildSuppressionFilterConfig,
  evaluateSuppressionFrame,
} from './hooks/useAudioEngine'

const SAMPLE_RATE = 48_000
const FFT_SIZE = 256
const SUPPRESSION_FFT_SIZE = 2048

function dbFromSlider(slider: number): number {
  return Math.round(20 * Math.log10(onThresholdFromSlider(slider)))
}

function dbFromLinear(value: number): number {
  return Math.round(20 * Math.log10(value))
}

function linearFromDb(value: number): number {
  return Math.pow(10, value / 20)
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

function buildSuppressionFrame({
  bodyDb,
  upperSpeechDb,
  highNoiseDb,
  lowNoiseDb,
}: {
  bodyDb: number
  upperSpeechDb: number
  highNoiseDb: number
  lowNoiseDb: number
}): Float32Array {
  const bins = new Float32Array(SUPPRESSION_FFT_SIZE / 2).fill(-96)
  const binWidth = SAMPLE_RATE / SUPPRESSION_FFT_SIZE
  const setBand = (minHz: number, maxHz: number, value: number) => {
    const start = Math.max(0, Math.floor(minHz / binWidth))
    const end = Math.min(bins.length - 1, Math.ceil(maxHz / binWidth))
    for (let i = start; i <= end; i++) bins[i] = value
  }

  setBand(0, 140, lowNoiseDb)
  setBand(180, 1599, bodyDb)
  setBand(1600, 3399, upperSpeechDb)
  setBand(3400, 7200, highNoiseDb)
  return bins
}

function suppressionConfigForPreset(preset: 'normal' | 'noisy') {
  localStorage.setItem('voxpery-settings-speaking-preset', preset)
  localStorage.setItem('voxpery-settings-voice-input-profile', 'isolation')
  return buildSuppressionConfig(true)
}

describe('voice quality benchmark configuration', () => {
  beforeEach(() => {
    localStorage.removeItem('voxpery-settings-speaking-preset')
    localStorage.removeItem('voxpery-settings-speaking-threshold')
    localStorage.removeItem('voxpery-settings-voice-input-profile')
    delete window.__VOXPERY_VOICE_DIAGNOSTICS__
  })

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

  it('keeps Balanced cleanup more natural than Noisy room cleanup', () => {
    const balancedFilters = buildSuppressionFilterConfig(true, 'balanced')
    const highFilters = buildSuppressionFilterConfig(true, 'high')

    expect(balancedFilters).toMatchObject({
      highPassHz: 110,
      lowPassHz: 7600,
      deClickGainDb: -1.2,
      speechPresenceGainDb: 0.5,
      compressorThresholdDb: -28,
      compressorKneeDb: 12,
      compressorRatio: 2.6,
      compressorAttackSec: 0.004,
      compressorReleaseSec: 0.12,
    })
    expect(highFilters).toMatchObject({
      highPassHz: 145,
      lowPassHz: 5600,
      deClickGainDb: -5,
      speechPresenceGainDb: 1,
      compressorThresholdDb: -37,
      compressorKneeDb: 8,
      compressorRatio: 4.8,
      compressorAttackSec: 0.002,
      compressorReleaseSec: 0.075,
    })
    expect(balancedFilters.highPassHz).toBeLessThan(highFilters.highPassHz)
    expect(balancedFilters.lowPassHz).toBeGreaterThan(highFilters.lowPassHz)
    expect(balancedFilters.deClickGainDb).toBeGreaterThan(highFilters.deClickGainDb)
    expect(balancedFilters.compressorThresholdDb).toBeGreaterThan(highFilters.compressorThresholdDb)
    expect(balancedFilters.compressorRatio).toBeLessThan(highFilters.compressorRatio)
    expect(balancedFilters.compressorAttackSec).toBeGreaterThan(highFilters.compressorAttackSec)
    expect(balancedFilters.compressorReleaseSec).toBeGreaterThan(highFilters.compressorReleaseSec)

    localStorage.setItem('voxpery-settings-speaking-preset', 'normal')
    localStorage.setItem('voxpery-settings-voice-input-profile', 'isolation')
    const balancedConfig = buildSuppressionConfig(true)
    localStorage.setItem('voxpery-settings-speaking-preset', 'noisy')
    const highConfig = buildSuppressionConfig(true)

    expect(dbFromLinear(balancedConfig.lowFloorThr)).toBe(-54)
    expect(dbFromLinear(balancedConfig.openFloorThr)).toBe(-42)
    expect(balancedConfig.minFloorGain).toBe(0.22)
    expect(balancedConfig.floorReleaseAlpha).toBe(0.045)
    expect(balancedConfig.floorReleaseTime).toBe(0.11)
    expect(balancedConfig.speechSafeFloorGain).toBe(0.9)
    expect(balancedConfig.isolationAttenuationAlpha).toBe(0.1)
    expect(dbFromLinear(highConfig.lowFloorThr)).toBe(-43)
    expect(dbFromLinear(highConfig.openFloorThr)).toBe(-31)
    expect(highConfig.minFloorGain).toBe(0.035)
    expect(highConfig.speechSafeFloorGain).toBe(0.82)
    expect(balancedConfig.minFloorGain).toBeGreaterThan(highConfig.minFloorGain)
    expect(balancedConfig.floorReleaseTime).toBeGreaterThan(highConfig.floorReleaseTime)
  })

  it('preserves clean speech without post-RNNoise attenuation in both presets', () => {
    const frame = buildSuppressionFrame({
      bodyDb: -24,
      upperSpeechDb: -28,
      highNoiseDb: -72,
      lowNoiseDb: -70,
    })

    for (const preset of ['normal', 'noisy'] as const) {
      const evaluation = evaluateSuppressionFrame(
        frame,
        SAMPLE_RATE,
        SUPPRESSION_FFT_SIZE,
        linearFromDb(-27),
        suppressionConfigForPreset(preset),
      )
      expect(evaluation).toEqual({
        targetFloorGain: 1,
        targetIsolationGain: 1,
        likelySpeech: true,
      })
    }
  })

  it('keeps quiet speech more open in Balanced while Noisy room retains bounded cleanup', () => {
    const frame = buildSuppressionFrame({
      bodyDb: -35,
      upperSpeechDb: -37,
      highNoiseDb: -41,
      lowNoiseDb: -50,
    })
    const rms = linearFromDb(-38)
    const balanced = evaluateSuppressionFrame(
      frame,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      rms,
      suppressionConfigForPreset('normal'),
    )
    const noisy = evaluateSuppressionFrame(
      frame,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      rms,
      suppressionConfigForPreset('noisy'),
    )

    expect(balanced.likelySpeech).toBe(true)
    expect(noisy.likelySpeech).toBe(true)
    expect(balanced.targetFloorGain).toBe(1)
    expect(balanced.targetIsolationGain).toBe(1)
    expect(noisy.targetFloorGain).toBeGreaterThanOrEqual(0.82)
    expect(noisy.targetIsolationGain).toBeGreaterThanOrEqual(0.46)
    expect(noisy.targetIsolationGain).toBeLessThan(1)
  })

  it('does not mistake speech mixed with keyboard transients for keyboard-only noise', () => {
    const speechWhileTyping = buildSuppressionFrame({
      bodyDb: -32,
      upperSpeechDb: -34,
      highNoiseDb: -29.4,
      lowNoiseDb: -68,
    })
    const rms = linearFromDb(-30)
    const balanced = evaluateSuppressionFrame(
      speechWhileTyping,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      rms,
      suppressionConfigForPreset('normal'),
    )
    const noisy = evaluateSuppressionFrame(
      speechWhileTyping,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      rms,
      suppressionConfigForPreset('noisy'),
    )

    expect(balanced.likelySpeech).toBe(true)
    expect(noisy.likelySpeech).toBe(true)
    expect(balanced.targetIsolationGain).toBe(1)
    expect(noisy.targetIsolationGain).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps keyboard and fan attenuation stronger in Noisy room without muting them to zero', () => {
    const keyboardFrame = buildSuppressionFrame({
      bodyDb: -56,
      upperSpeechDb: -48,
      highNoiseDb: -27,
      lowNoiseDb: -78,
    })
    const fanFrame = buildSuppressionFrame({
      bodyDb: -54,
      upperSpeechDb: -58,
      highNoiseDb: -64,
      lowNoiseDb: -28,
    })
    const balancedConfig = suppressionConfigForPreset('normal')
    const noisyConfig = suppressionConfigForPreset('noisy')
    const balancedKeyboard = evaluateSuppressionFrame(
      keyboardFrame,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      linearFromDb(-31),
      balancedConfig,
    )
    const noisyKeyboard = evaluateSuppressionFrame(
      keyboardFrame,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      linearFromDb(-31),
      noisyConfig,
    )
    const balancedFan = evaluateSuppressionFrame(
      fanFrame,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      linearFromDb(-42),
      balancedConfig,
    )
    const noisyFan = evaluateSuppressionFrame(
      fanFrame,
      SAMPLE_RATE,
      SUPPRESSION_FFT_SIZE,
      linearFromDb(-42),
      noisyConfig,
    )

    expect(balancedKeyboard.likelySpeech).toBe(false)
    expect(noisyKeyboard.likelySpeech).toBe(false)
    expect(balancedFan.likelySpeech).toBe(false)
    expect(noisyFan.likelySpeech).toBe(false)
    expect(noisyKeyboard.targetIsolationGain).toBeGreaterThan(0)
    expect(noisyKeyboard.targetIsolationGain).toBeLessThan(balancedKeyboard.targetIsolationGain)
    expect(noisyFan.targetIsolationGain).toBeGreaterThan(0)
    expect(noisyFan.targetIsolationGain).toBeLessThan(balancedFan.targetIsolationGain)
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
