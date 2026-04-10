import { getOrCreateAudioContext, playCueStack } from './audioCues'

const SOUND_KEY = 'voxpery-settings-sound-enabled'

const audioCtxRef: { current: AudioContext | null } = { current: null }

export function shouldPlayNotificationSound(status: string | undefined): boolean {
  if (localStorage.getItem(SOUND_KEY) === '0') return false
  return status !== 'dnd'
}

export function playMessageNotificationSound(): void {
  const ctx = getOrCreateAudioContext(audioCtxRef)
  if (!ctx) return

  playCueStack(ctx, [
    {
      from: 620,
      to: 580,
      durationSec: 0.14,
      peak: 0.014,
      type: 'sine',
      overtoneGain: 0.08,
      filterHz: 1800,
    },
    {
      from: 880,
      to: 820,
      offsetSec: 0.055,
      durationSec: 0.12,
      peak: 0.011,
      type: 'sine',
      overtoneGain: 0.05,
      filterHz: 2200,
    },
  ])
}
