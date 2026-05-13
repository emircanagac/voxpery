import { describe, expect, it } from 'vitest'
import {
  classifyVoiceError,
  getVoiceNetworkQuality,
  getVoiceQualityAdvice,
  getVoicePingLevel,
  updateVoiceDiagnostics,
  voiceQualityLabel,
} from './voiceDiagnostics'

describe('voiceDiagnostics', () => {
  it('classifies healthy, fair, and poor network quality', () => {
    expect(getVoiceNetworkQuality({
      hasActiveVoiceSession: true,
      pingMs: 48,
      packetLossPct: 0,
      jitterMs: 4,
      pingJitterMs: 6,
    }).level).toBe('good')

    expect(getVoiceNetworkQuality({
      hasActiveVoiceSession: true,
      pingMs: 130,
      packetLossPct: 0.5,
      jitterMs: 8,
      pingJitterMs: 12,
    }).level).toBe('fair')

    expect(getVoiceNetworkQuality({
      hasActiveVoiceSession: true,
      pingMs: 80,
      packetLossPct: 6,
      jitterMs: 8,
      pingJitterMs: 12,
    }).level).toBe('poor')
  })

  it('colors the compact ping indicator from visible ping only', () => {
    expect(getVoicePingLevel(false, null)).toBe('unknown')
    expect(getVoicePingLevel(true, 2)).toBe('good')
    expect(getVoicePingLevel(true, 140)).toBe('fair')
    expect(getVoicePingLevel(true, 260)).toBe('poor')
  })

  it('classifies unavailable voice service errors without leaking raw internals', () => {
    const result = classifyVoiceError(new Error('FEATURE_DISABLED:Voice service is not configured.'))

    expect(result.title).toBe('Voice service unavailable')
    expect(result.message).toContain('Voice media service is unavailable')
  })

  it('classifies permission and device failures', () => {
    expect(classifyVoiceError(new Error('Microphone permission denied')).title).toBe('Microphone access required')
    expect(classifyVoiceError(new Error('No microphone device detected')).title).toBe('No microphone detected')
    expect(classifyVoiceError(new Error('Microphone is in use by another app')).title).toBe('Microphone is busy')
  })

  it('returns concise labels and advice', () => {
    const summary = getVoiceNetworkQuality({
      hasActiveVoiceSession: true,
      pingMs: 240,
      packetLossPct: 0,
      jitterMs: 2,
      pingJitterMs: 3,
    })

    expect(voiceQualityLabel(summary.level)).toBe('Poor voice quality')
    expect(getVoiceQualityAdvice(summary, 'connected')).toContain('steadier connection')
    expect(getVoiceQualityAdvice(summary, 'reconnecting')).toContain('reconnecting')
  })

  it('exposes RNNoise runtime diagnostics for release smoke checks', () => {
    updateVoiceDiagnostics({
      rnnoiseStatus: 'ready',
      noiseSuppressionEnabled: true,
      voiceInputProfile: 'custom',
      suppressionTuning: 'high',
      aggressiveIsolation: true,
    })

    expect(window.__VOXPERY_VOICE_DIAGNOSTICS__).toMatchObject({
      rnnoiseStatus: 'ready',
      noiseSuppressionEnabled: true,
      voiceInputProfile: 'custom',
      suppressionTuning: 'high',
      aggressiveIsolation: true,
    })
    expect(window.__VOXPERY_VOICE_DIAGNOSTICS__?.updatedAt).toEqual(expect.any(String))
  })
})
