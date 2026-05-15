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
      from: 1046,
      durationSec: 0.055,
      peak: 0.012,
      type: 'sine',
      overtoneGain: 0.03,
      filterHz: 2800,
      q: 0.55,
    },
    {
      from: 1568,
      offsetSec: 0.045,
      durationSec: 0.075,
      peak: 0.009,
      type: 'sine',
      overtoneGain: 0.02,
      filterHz: 3600,
      q: 0.5,
    },
  ])
}
