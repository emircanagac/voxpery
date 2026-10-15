import { SENSITIVITY_THRESHOLD_KEY } from '../webrtc/sensitivityThreshold'
import { VOICE_SETTINGS_CHANGED_EVENT } from '../voiceDevices'

// Shared by the user bar and its settings window.

export const VOXPERY_RELEASES_URL = 'https://github.com/emircanagac/voxpery/releases/latest'
export const SETTINGS_CHANGED_EVENT = VOICE_SETTINGS_CHANGED_EVENT
export const SOUND_KEY = 'voxpery-settings-sound-enabled'
export const INPUT_VOL_KEY = 'voxpery-settings-input-volume'
export const OUTPUT_VOL_KEY = 'voxpery-settings-output-volume'
export const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'
export const SPEAKING_THRESHOLD_KEY = SENSITIVITY_THRESHOLD_KEY

export type SettingsSection = 'profile' | 'appearance' | 'communication' | 'voice' | 'desktop' | 'privacy'
export type PhotoLeavePrompt = { action: 'close' } | { action: 'section'; section: SettingsSection }
export type VoiceDeviceMenu = 'input' | 'output'

export function getInitial(name: string) {
  return name.charAt(0).toUpperCase()
}

export function statusLabel(status?: string) {
  if (status === 'dnd') return 'Do Not Disturb'
  if (status === 'invisible' || status === 'offline') return 'Invisible'
  return 'Online'
}

export function footerStatusLabel(status?: string) {
  if (status === 'dnd') return 'DND'
  if (status === 'invisible' || status === 'offline') return 'Invisible'
  return 'Online'
}
