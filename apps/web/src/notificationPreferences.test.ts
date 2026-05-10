import { describe, expect, it, beforeEach } from 'vitest'
import {
  DEFAULT_SERVER_NOTIFICATION_PREFERENCE,
  getServerNotificationPreference,
  SERVER_NOTIFICATION_PREFERENCE_KEY,
  setServerNotificationPreference,
  shouldNotifyForServerMessage,
  shouldTrackServerUnread,
} from './notificationPreferences'

describe('notification preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults server notifications to mentions only', () => {
    expect(getServerNotificationPreference()).toBe(DEFAULT_SERVER_NOTIFICATION_PREFERENCE)
  })

  it('persists the selected server notification preference', () => {
    setServerNotificationPreference('all')
    expect(localStorage.getItem(SERVER_NOTIFICATION_PREFERENCE_KEY)).toBe('all')
    expect(getServerNotificationPreference()).toBe('all')
  })

  it('ignores invalid stored server notification preference values', () => {
    localStorage.setItem(SERVER_NOTIFICATION_PREFERENCE_KEY, 'loud')
    expect(getServerNotificationPreference()).toBe(DEFAULT_SERVER_NOTIFICATION_PREFERENCE)
  })

  it('tracks mentions in muted channels without tracking normal unread', () => {
    expect(shouldTrackServerUnread({
      isMention: false,
      isMutedServer: false,
      isMutedChannel: true,
    })).toBe(false)

    expect(shouldTrackServerUnread({
      isMention: true,
      isMutedServer: false,
      isMutedChannel: true,
    })).toBe(true)
  })

  it('suppresses server notifications based on mute state and preference', () => {
    expect(shouldNotifyForServerMessage({
      preference: 'mentions',
      isMention: false,
      isMutedServer: false,
      isMutedChannel: false,
    })).toBe(false)

    expect(shouldNotifyForServerMessage({
      preference: 'mentions',
      isMention: true,
      isMutedServer: false,
      isMutedChannel: true,
    })).toBe(true)

    expect(shouldNotifyForServerMessage({
      preference: 'all',
      isMention: false,
      isMutedServer: true,
      isMutedChannel: false,
    })).toBe(false)
  })
})
