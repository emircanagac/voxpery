import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({
  isTauri: false,
  invoke: vi.fn(),
  clickListener: null as null | ((event: { payload: string }) => void),
}))
vi.mock('./secureStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./secureStorage')>()),
  isTauri: () => desktop.isTauri,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: desktop.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: (event: { payload: string }) => void) => {
    desktop.clickListener = handler
    return () => { desktop.clickListener = null }
  }),
}))
import {
  getPushNotificationsEnabled,
  PUSH_NOTIFICATION_STATE_CHANGED_EVENT,
  requestPushNotificationPermission,
  setPushNotificationsEnabled,
  shouldShowPushNotification,
  listenForNotificationClicks,
  NOTIFICATION_CLICK_MESSAGE,
  NOTIFICATION_TARGET_HASH,
  parseNotificationTarget,
  setNotificationTargetHandler,
  showPushNotification,
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

describe('notification display and clicks', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  function stubServiceWorker(registration: unknown) {
    const listeners = new Set<(event: MessageEvent) => void>()
    const container = {
      getRegistration: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn((_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener)),
      startMessages: vi.fn(),
    }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
    return {
      container,
      post: (data: unknown) => listeners.forEach((listener) => listener(new MessageEvent('message', { data }))),
      remove: () => Reflect.deleteProperty(navigator, 'serviceWorker'),
    }
  }

  it('shows the notification through the active service worker with its target', async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined)
    const NotificationCtor = vi.fn()
    vi.stubGlobal('Notification', Object.assign(NotificationCtor, { permission: 'granted' }))
    const sw = stubServiceWorker({ active: {}, showNotification })

    showPushNotification({ title: 'Ada', body: 'hi', tag: 'dm:c1', target: { kind: 'dm', channelId: 'c1', messageId: 'm1' } })

    await vi.waitFor(() => expect(showNotification).toHaveBeenCalledTimes(1))
    expect(showNotification.mock.calls[0][1]).toMatchObject({ tag: 'dm:c1', data: { target: { kind: 'dm', channelId: 'c1', messageId: 'm1' } } })
    expect(NotificationCtor).not.toHaveBeenCalled()
    sw.remove()
  })

  it('falls back to an in-page notification without a service worker and never throws', async () => {
    const instances: Array<{ onclick: (() => void) | null; close: () => void }> = []
    const NotificationCtor = vi.fn(function (this: { onclick: (() => void) | null; close: () => void }) {
      this.onclick = null
      this.close = vi.fn()
      instances.push(this)
    })
    vi.stubGlobal('Notification', Object.assign(NotificationCtor, { permission: 'granted' }))
    const sw = stubServiceWorker(undefined)
    const opened = vi.fn()
    const removeHandler = setNotificationTargetHandler(opened)
    vi.spyOn(window, 'focus').mockImplementation(() => {})

    showPushNotification({ title: 'Ping', body: 'hi', target: { kind: 'server_channel', serverId: 's1', channelId: 'c1' } })
    await vi.waitFor(() => expect(NotificationCtor).toHaveBeenCalledTimes(1))
    instances[0].onclick?.()
    expect(opened).toHaveBeenCalledWith({ kind: 'server_channel', serverId: 's1', channelId: 'c1' })

    // Android Chrome: the constructor throws and there is no active service worker.
    NotificationCtor.mockImplementation(() => {
      throw new TypeError('Illegal constructor')
    })
    expect(() => showPushNotification({ title: 'Ping', body: 'hi' })).not.toThrow()
    await vi.waitFor(() => expect(NotificationCtor).toHaveBeenCalledTimes(2))
    removeHandler()
    sw.remove()
  })

  it('opens targets handed over by the service worker or a new window, and ignores malformed ones', () => {
    const sw = stubServiceWorker(undefined)
    const opened = vi.fn()
    const removeHandler = setNotificationTargetHandler(opened)
    const target = { kind: 'dm', channelId: 'dm-1', messageId: null }
    window.history.replaceState(null, '', `/social/dm${NOTIFICATION_TARGET_HASH}${encodeURIComponent(JSON.stringify(target))}`)

    const stop = listenForNotificationClicks()
    expect(opened).toHaveBeenCalledWith(target)
    expect(window.location.hash).toBe('')

    sw.post({ type: NOTIFICATION_CLICK_MESSAGE, target: { kind: 'server_channel', serverId: 's1', channelId: 'c1' } })
    sw.post({ type: NOTIFICATION_CLICK_MESSAGE, target: { kind: 'server_channel', serverId: '../x', channelId: 'c1' } })
    sw.post({ type: 'other', target })
    expect(opened).toHaveBeenCalledTimes(2)
    expect(opened).toHaveBeenLastCalledWith({ kind: 'server_channel', serverId: 's1', channelId: 'c1' })

    stop()
    sw.post({ type: NOTIFICATION_CLICK_MESSAGE, target })
    expect(opened).toHaveBeenCalledTimes(2)
    expect(parseNotificationTarget({ kind: 'dm', channelId: 'a b' })).toBeNull()
    removeHandler()
    sw.remove()
  })
})

describe('desktop app notifications', () => {
  beforeEach(() => {
    desktop.isTauri = true
    desktop.invoke.mockReset().mockResolvedValue(undefined)
    desktop.clickListener = null
  })
  afterEach(() => {
    desktop.isTauri = false
  })

  it('needs no webview permission and never asks WebView2', async () => {
    const requestPermission = vi.fn(async () => 'denied' as NotificationPermission)
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'denied', requestPermission }))
    await expect(requestPushNotificationPermission()).resolves.toBe('granted')
    expect(requestPermission).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('shows notifications through the desktop shell with the click target', async () => {
    showPushNotification({
      title: 'Mention in #general',
      body: 'friend: hi',
      target: { kind: 'dm', channelId: 'dm-1', messageId: null },
    })
    await vi.waitFor(() => expect(desktop.invoke).toHaveBeenCalledWith('desktop_show_notification', {
      title: 'Mention in #general',
      body: 'friend: hi',
      target: JSON.stringify({ kind: 'dm', channelId: 'dm-1', messageId: null }),
    }))
  })

  it('opens the conversation of a clicked desktop notification', async () => {
    const opened = vi.fn()
    const stopHandler = setNotificationTargetHandler(opened)
    const stop = listenForNotificationClicks()
    await vi.waitFor(() => expect(desktop.clickListener).not.toBeNull())
    desktop.clickListener!({ payload: JSON.stringify({ kind: 'server_channel', serverId: 's-1', channelId: 'c-1' }) })
    expect(opened).toHaveBeenCalledWith({ kind: 'server_channel', serverId: 's-1', channelId: 'c-1' })
    desktop.clickListener!({ payload: 'not json' })
    expect(opened).toHaveBeenCalledTimes(1)
    stop()
    stopHandler()
  })
})
