import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPushNotificationsEnabled,
  PUSH_NOTIFICATION_STATE_CHANGED_EVENT,
  requestPushNotificationPermission,
  setPushNotificationsEnabled,
  shouldShowPushNotification,
} from './pushNotifications'

describe('manual notification preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('does not request permission merely by reading notification state', () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    expect(getPushNotificationsEnabled()).toBe(false)
    expect(shouldShowPushNotification('online')).toBe(false)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('requests permission explicitly and announces the result', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })
    const changed = vi.fn()
    window.addEventListener(PUSH_NOTIFICATION_STATE_CHANGED_EVENT, changed, { once: true })
    expect(await requestPushNotificationPermission()).toBe('granted')
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('persists opt-in and opt-out without requesting permission', () => {
    const requestPermission = vi.fn()
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
    setPushNotificationsEnabled(true, true)
    expect(getPushNotificationsEnabled()).toBe(true)
    expect(localStorage.getItem('voxpery-settings-push-explicit')).toBe('1')
    setPushNotificationsEnabled(false, true)
    expect(getPushNotificationsEnabled()).toBe(false)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('retains permission, foreground and DND delivery guards', () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    setPushNotificationsEnabled(true)
    expect(shouldShowPushNotification('online')).toBe(true)
    expect(shouldShowPushNotification('dnd')).toBe(false)
    focused.mockReturnValue(true)
    expect(shouldShowPushNotification('online')).toBe(false)
    focused.mockReturnValue(false)
    vi.stubGlobal('Notification', { permission: 'denied' })
    expect(shouldShowPushNotification('online')).toBe(false)
  })
})
