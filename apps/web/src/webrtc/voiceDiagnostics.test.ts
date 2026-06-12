import { beforeEach, describe, expect, it } from 'vitest'
import {
  VOICE_DIAGNOSTICS_STORAGE_KEY,
  classifyVoiceError,
  formatVoiceDiagnosticsSnapshot,
  getVoiceDiagnosticsSnapshot,
  getVoiceNetworkQuality,
  getVoiceQualityAdvice,
  getVoicePingLevel,
  isVoiceDiagnosticsEnabled,
  linearToDbDiagnostic,
  toVoiceProcessingConstraintsDiagnostics,
  toVoiceTrackSettingsDiagnostics,
  updateVoiceDiagnostics,
  voiceQualityLabel,
} from './voiceDiagnostics'

describe('voiceDiagnostics', () => {
  beforeEach(() => {
    window.localStorage.removeItem(VOICE_DIAGNOSTICS_STORAGE_KEY)
    delete window.__VOXPERY_VOICE_DIAGNOSTICS__
  })

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

  it('keeps RNNoise runtime diagnostics hidden until explicitly enabled', () => {
    expect(isVoiceDiagnosticsEnabled()).toBe(false)

    updateVoiceDiagnostics({
      rnnoiseStatus: 'ready',
      noiseSuppressionEnabled: true,
    })

    expect(window.__VOXPERY_VOICE_DIAGNOSTICS__).toBeUndefined()
  })

  it('exposes RNNoise runtime diagnostics for opt-in release smoke checks', () => {
    window.localStorage.setItem(VOICE_DIAGNOSTICS_STORAGE_KEY, '1')
    expect(isVoiceDiagnosticsEnabled()).toBe(true)

    updateVoiceDiagnostics({
      rnnoiseStatus: 'ready',
      noiseSuppressionEnabled: true,
      voiceInputProfile: 'custom',
      speakingPreset: 'noisy',
      speakingThreshold: 60,
      speakingThresholdDb: -40,
      suppressionTuning: 'high',
      aggressiveIsolation: true,
    })

    expect(window.__VOXPERY_VOICE_DIAGNOSTICS__).toMatchObject({
      rnnoiseStatus: 'ready',
      noiseSuppressionEnabled: true,
      voiceInputProfile: 'custom',
      speakingPreset: 'noisy',
      speakingThreshold: 60,
      speakingThresholdDb: -40,
      suppressionTuning: 'high',
      aggressiveIsolation: true,
    })
    expect(window.__VOXPERY_VOICE_DIAGNOSTICS__?.updatedAt).toEqual(expect.any(String))
  })

  it('returns a copyable runtime diagnostics snapshot', () => {
    window.localStorage.setItem(VOICE_DIAGNOSTICS_STORAGE_KEY, '1')
    updateVoiceDiagnostics({
      benchmarkSchemaVersion: 1,
      rnnoiseStatus: 'ready',
      noiseSuppressionEnabled: true,
      voiceInputProfile: 'isolation',
      speakingPreset: 'normal',
      speakingThreshold: 42,
      speakingThresholdDb: -58,
      suppressionTuning: 'balanced',
      aggressiveIsolation: true,
      captureConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      rawMicTrackSettings: {
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      voiceActivity: {
        mode: 'voice_activity',
        gateOpen: true,
        speaking: true,
        rmsDb: -36.5,
        smoothedRmsDb: -39.2,
        onThresholdDb: -58,
        offThresholdDb: -62,
        openFrames: 2,
        belowFrames: 0,
      },
      network: {
        pingMs: 42,
        wsPingMs: 48,
        rtcPingMs: 42,
        packetLossPct: 0,
        jitterMs: 3,
        pingJitterMs: 4,
        pingSource: 'rtc',
      },
      livekit: {
        microphonePublished: true,
        microphoneSource: 'processed-webaudio',
        microphoneAudioPreset: 'musicHighQuality',
        microphoneDtx: true,
        microphoneRed: true,
        microphoneForceStereo: false,
      },
    })

    const snapshot = getVoiceDiagnosticsSnapshot()
    expect(snapshot).toMatchObject({
      rnnoiseStatus: 'ready',
      speakingPreset: 'normal',
      speakingThresholdDb: -58,
      suppressionTuning: 'balanced',
      captureConstraints: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      voiceActivity: {
        mode: 'voice_activity',
        gateOpen: true,
        speaking: true,
      },
      network: {
        pingMs: 42,
        rtcPingMs: 42,
        pingSource: 'rtc',
      },
      livekit: {
        microphonePublished: true,
        microphoneSource: 'processed-webaudio',
        microphoneAudioPreset: 'musicHighQuality',
        microphoneDtx: true,
        microphoneRed: true,
        microphoneForceStereo: false,
      },
    })
    expect(snapshot).not.toBe(window.__VOXPERY_VOICE_DIAGNOSTICS__)
    expect(formatVoiceDiagnosticsSnapshot(snapshot!)).toContain('"speakingThresholdDb": -58')
  })

  it('sanitizes audio track settings for benchmark diagnostics', () => {
    const settings = {
      sampleRate: 48000,
      sampleSize: 16,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      latency: 0.015,
      deviceId: 'private-device-id',
      groupId: 'private-group-id',
    } as MediaTrackSettings

    expect(toVoiceTrackSettingsDiagnostics(settings)).toEqual({
      sampleRate: 48000,
      sampleSize: 16,
      channelCount: 1,
      latency: 0.015,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    })
  })

  it('keeps only boolean capture constraints in benchmark diagnostics', () => {
    expect(toVoiceProcessingConstraintsDiagnostics({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: { ideal: true },
    })).toEqual({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: undefined,
    })
  })

  it('converts linear audio values to stable diagnostic dB values', () => {
    expect(linearToDbDiagnostic(1)).toBe(0)
    expect(linearToDbDiagnostic(0)).toBe(-100)
    expect(linearToDbDiagnostic(0.001)).toBe(-60)
  })
})
