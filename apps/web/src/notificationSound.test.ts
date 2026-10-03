import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrCreateAudioContext, playCueStack } from './audioCues'
import { MESSAGE_NOTIFICATION_TONES, playMessageNotificationSound, shouldPlayNotificationSound } from './notificationSound'

vi.mock('./audioCues', async (importOriginal) => ({
  ...await importOriginal<typeof import('./audioCues')>(),
  getOrCreateAudioContext: vi.fn(),
  playCueStack: vi.fn(),
}))

describe('message notification sound', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it.each(['online', 'idle', 'offline', undefined])('allows the shared message sound for %s', (status) => {
    expect(shouldPlayNotificationSound(status)).toBe(true)
  })

  it('preserves do-not-disturb and disabled sound preferences', () => {
    expect(shouldPlayNotificationSound('dnd')).toBe(false)
    localStorage.setItem('voxpery-settings-sound-enabled', '0')
    expect(shouldPlayNotificationSound('online')).toBe(false)
    localStorage.setItem('voxpery-settings-sound-enabled', '1')
    expect(shouldPlayNotificationSound('online')).toBe(true)
  })

  it('uses one short, soft double tap below the camera-bell register', () => {
    expect(MESSAGE_NOTIFICATION_TONES).toHaveLength(2)
    const [first, second] = MESSAGE_NOTIFICATION_TONES
    expect(second.offsetSec).toBeGreaterThan(first.durationSec)
    expect((second.offsetSec ?? 0) + second.durationSec).toBeLessThanOrEqual(0.2)
    for (const tone of MESSAGE_NOTIFICATION_TONES) {
      expect(tone.type).toBe('sine')
      expect(tone.from).toBeGreaterThan(400)
      expect(tone.from).toBeLessThan(1000)
      expect(tone.to).toBeLessThan(tone.from)
      expect(tone.peak).toBeGreaterThan(0)
      expect(tone.peak).toBeLessThanOrEqual(0.026)
    }
  })

  it('plays the same catalog through the shared renderer', () => {
    const ctx = {} as AudioContext
    vi.mocked(getOrCreateAudioContext).mockReturnValue(ctx)
    playMessageNotificationSound()
    expect(playCueStack).toHaveBeenCalledExactlyOnceWith(ctx, [...MESSAGE_NOTIFICATION_TONES])
  })

  it('does not try to play when Web Audio is unavailable', () => {
    vi.mocked(getOrCreateAudioContext).mockReturnValue(null)
    playMessageNotificationSound()
    expect(playCueStack).not.toHaveBeenCalled()
  })
})
