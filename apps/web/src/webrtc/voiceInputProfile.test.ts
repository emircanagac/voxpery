import { describe, expect, it } from 'vitest'
import {
  getVoiceSuppressionTuning,
  shouldRebuildSuppressionPipeline,
  shouldUseAggressiveVoiceIsolation,
} from './voiceInputProfile'

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

  it('applies aggressive isolation only for isolation profile with suppression enabled', () => {
    expect(shouldUseAggressiveVoiceIsolation('isolation', true)).toBe(true)
    expect(shouldUseAggressiveVoiceIsolation('custom', true)).toBe(false)
    expect(shouldUseAggressiveVoiceIsolation('isolation', false)).toBe(false)
  })

  it('marks pipeline rebuild only when suppression tier changes', () => {
    expect(shouldRebuildSuppressionPipeline('balanced', 'high')).toBe(true)
    expect(shouldRebuildSuppressionPipeline('balanced', 'balanced')).toBe(false)
  })
})
