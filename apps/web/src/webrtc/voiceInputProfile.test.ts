import { beforeEach, describe, expect, it } from 'vitest'
import {
  getStoredVoiceMode,
  getVoiceSuppressionTuning,
  shouldRebuildSuppressionPipeline,
  shouldUseAggressiveVoiceIsolation,
  VOICE_INPUT_PROFILE_KEY,
  VOICE_MODE_KEY,
} from './voiceInputProfile'

describe('stored voice activation mode', () => {
  beforeEach(() => localStorage.clear())

  it('uses voice activity for built-in profiles even when a stale PTT value remains', () => {
    localStorage.setItem(VOICE_INPUT_PROFILE_KEY, 'isolation')
    localStorage.setItem(VOICE_MODE_KEY, 'push_to_talk')

    expect(getStoredVoiceMode()).toBe('voice_activity')
  })

  it('preserves an explicitly configured custom PTT mode', () => {
    localStorage.setItem(VOICE_INPUT_PROFILE_KEY, 'custom')
    localStorage.setItem(VOICE_MODE_KEY, 'push_to_talk')

    expect(getStoredVoiceMode()).toBe('push_to_talk')
  })

  it('preserves legacy PTT settings until they are migrated to a custom profile', () => {
    localStorage.setItem(VOICE_MODE_KEY, 'push_to_talk')

    expect(getStoredVoiceMode()).toBe('push_to_talk')
  })
})

describe('voiceInputProfile suppression tuning', () => {
  it('maps low thresholds to balanced cleanup and high thresholds to high cleanup', () => {
    expect(getVoiceSuppressionTuning('isolation', 30, true)).toBe('balanced') // -70dB
    expect(getVoiceSuppressionTuning('isolation', 42, true)).toBe('balanced') // -58dB
    expect(getVoiceSuppressionTuning('isolation', 54, true)).toBe('high') // -46dB
    expect(getVoiceSuppressionTuning('isolation', 70, true)).toBe('high') // -30dB
  })

  it('returns off when suppression is disabled or profile is studio', () => {
    expect(getVoiceSuppressionTuning('isolation', 70, false)).toBe('off')
    expect(getVoiceSuppressionTuning('studio', 70, true)).toBe('off')
  })

  it('keeps aggressive isolation for custom settings when suppression is enabled', () => {
    expect(shouldUseAggressiveVoiceIsolation('isolation', true)).toBe(true)
    expect(shouldUseAggressiveVoiceIsolation('custom', true)).toBe(true)
    expect(shouldUseAggressiveVoiceIsolation('isolation', false)).toBe(false)
    expect(shouldUseAggressiveVoiceIsolation('studio', true)).toBe(false)
  })

  it('marks pipeline rebuild only when suppression tier changes', () => {
    expect(shouldRebuildSuppressionPipeline('balanced', 'high')).toBe(true)
    expect(shouldRebuildSuppressionPipeline('balanced', 'balanced')).toBe(false)
  })
})
