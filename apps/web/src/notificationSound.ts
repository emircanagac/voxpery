import { getOrCreateAudioContext, playCueStack, type CueTone } from './audioCues'

const SOUND_KEY = 'voxpery-settings-sound-enabled'

const audioCtxRef: { current: AudioContext | null } = { current: null }

export const MESSAGE_NOTIFICATION_TONES: readonly CueTone[] = [
  { from: 659.25, to: 587.33, durationSec: 0.075, peak: 0.026, type: 'sine', overtoneGain: 0.04, filterHz: 1800, q: 0.55 },
  { from: 783.99, to: 698.46, offsetSec: 0.085, durationSec: 0.09, peak: 0.023, type: 'sine', overtoneGain: 0.03, filterHz: 2000, q: 0.55 },
]

export function shouldPlayNotificationSound(status: string | undefined): boolean {
  if (localStorage.getItem(SOUND_KEY) === '0') return false
  return status !== 'dnd'
}

export function playMessageNotificationSound(): void {
  const ctx = getOrCreateAudioContext(audioCtxRef)
  if (!ctx) return

  playCueStack(ctx, [...MESSAGE_NOTIFICATION_TONES])
}
