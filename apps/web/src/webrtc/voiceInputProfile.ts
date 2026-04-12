import { DEFAULT_SPEAKING_PRESET, thresholdByPreset, type SpeakingPreset } from './sensitivityThreshold'

export const VOICE_INPUT_PROFILE_KEY = 'voxpery-settings-voice-input-profile'

export type VoiceInputProfile = 'isolation' | 'studio' | 'custom'

export interface VoiceInputProfileConfig {
  profile: VoiceInputProfile
  voiceMode: 'voice_activity' | 'push_to_talk'
  noiseSuppressionEnabled: boolean
  speakingPreset: SpeakingPreset
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
      speakingPreset: 'quiet',
      speakingThreshold: thresholdByPreset('quiet'),
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
  // Noise suppression behavior should stay stable across sensitivity presets.
  // Presets/custom only tune the VAD threshold; profile controls the processing style.
  return profile === 'isolation'
}
