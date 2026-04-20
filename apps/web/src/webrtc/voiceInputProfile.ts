import {
  DEFAULT_SPEAKING_PRESET,
  getSliderFromStorage,
  thresholdByPreset,
} from './sensitivityThreshold'

export const VOICE_INPUT_PROFILE_KEY = 'voxpery-settings-voice-input-profile'

export type VoiceInputProfile = 'isolation' | 'studio' | 'custom'
export type VoiceSuppressionTuning = 'off' | 'balanced' | 'high'

export interface VoiceInputProfileConfig {
  profile: VoiceInputProfile
  voiceMode: 'voice_activity' | 'push_to_talk'
  noiseSuppressionEnabled: boolean
  speakingPreset: 'normal' | 'noisy' | 'custom'
  speakingThreshold: number
}

export const DEFAULT_VOICE_INPUT_PROFILE: VoiceInputProfile = 'isolation'

export function isVoiceInputProfile(value: string | null | undefined): value is VoiceInputProfile {
  return value === 'isolation' || value === 'studio' || value === 'custom'
}

export function getStoredVoiceInputProfile(): VoiceInputProfile {
  const raw = typeof localStorage !== 'undefined'
    ? localStorage.getItem(VOICE_INPUT_PROFILE_KEY)
    : null
  return isVoiceInputProfile(raw) ? raw : DEFAULT_VOICE_INPUT_PROFILE
}

export function getVoiceInputProfileConfig(profile: VoiceInputProfile): VoiceInputProfileConfig {
  if (profile === 'studio') {
    return {
      profile,
      voiceMode: 'voice_activity',
      noiseSuppressionEnabled: false,
      speakingPreset: 'normal',
      speakingThreshold: thresholdByPreset('normal'),
    }
  }

  if (profile === 'custom') {
    return {
      profile,
      voiceMode: 'voice_activity',
      noiseSuppressionEnabled: true,
      speakingPreset: DEFAULT_SPEAKING_PRESET,
      speakingThreshold: thresholdByPreset(DEFAULT_SPEAKING_PRESET),
    }
  }

  return {
    profile: 'isolation',
    voiceMode: 'voice_activity',
    noiseSuppressionEnabled: true,
    speakingPreset: 'normal',
    speakingThreshold: thresholdByPreset('normal'),
  }
}

export function getVoiceProfileSummary(profile: VoiceInputProfile): string {
  if (profile === 'studio') return 'Raw voice with minimal processing for maximum natural tone.'
  if (profile === 'custom') return 'Fine-tuned settings with manual control over sensitivity and mode.'
  return 'Default isolation profile optimized for keyboard and room-noise suppression.'
}

export function shouldUseAggressiveVoiceIsolation(
  profile: VoiceInputProfile,
  noiseSuppressionEnabled: boolean,
): boolean {
  if (!noiseSuppressionEnabled) return false
  // Profile still controls the overall isolation style; preset tuning is layered on top.
  return profile === 'isolation'
}

export function getVoiceSuppressionTuning(
  profile: VoiceInputProfile,
  speakingThreshold: number,
  noiseSuppressionEnabled: boolean,
): VoiceSuppressionTuning {
  if (!noiseSuppressionEnabled || profile === 'studio') return 'off'
  const thresholdDb = Math.max(-100, Math.min(0, Math.round(speakingThreshold - 100)))
  if (thresholdDb <= -53) return 'balanced'
  return 'high'
}

export function getVoiceSuppressionTuningLabel(tuning: VoiceSuppressionTuning): string {
  if (tuning === 'high') return 'strong cleanup'
  if (tuning === 'balanced') return 'balanced cleanup'
  return 'suppression off'
}

export function getVoiceSuppressionTuningSummary(tuning: VoiceSuppressionTuning): string {
  if (tuning === 'high') return 'Stronger cleanup for keyboard and room noise.'
  if (tuning === 'balanced') return 'Recommended default for most setups.'
  return 'Noise suppression is disabled.'
}

export function getVoiceSuppressionTuningForStoredThreshold(
  profile: VoiceInputProfile,
  noiseSuppressionEnabled: boolean,
): VoiceSuppressionTuning {
  const speakingThreshold = getSliderFromStorage()
  return getVoiceSuppressionTuning(profile, speakingThreshold, noiseSuppressionEnabled)
}

export function getVoiceSuppressionTuningForThreshold(
  threshold: number,
  noiseSuppressionEnabled: boolean,
): VoiceSuppressionTuning {
  return getVoiceSuppressionTuning(getStoredVoiceInputProfile(), threshold, noiseSuppressionEnabled)
}

export function getStoredVoiceSuppressionTuning(
  noiseSuppressionEnabled: boolean,
): VoiceSuppressionTuning {
  return getVoiceSuppressionTuningForStoredThreshold(
    getStoredVoiceInputProfile(),
    noiseSuppressionEnabled,
  )
}

export function shouldRebuildSuppressionPipeline(
  previous: VoiceSuppressionTuning,
  next: VoiceSuppressionTuning,
): boolean {
  return previous !== next
}
