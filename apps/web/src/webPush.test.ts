import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './api/client'
import { applicationServerKey, browserPushEnabled, disableBrowserPush, enableBrowserPush, webPushSupported } from './webPush'

vi.mock('./api/client', () => ({ apiFetch: vi.fn() }))
vi.mock('./secureStorage', () => ({ isTauri: vi.fn(() => false) }))

// An uncompressed P-256 point layout (0x04 + 64 bytes). The client only decodes the key, so it
// does not need to be a point on the curve, and no key material is written into the source.
const SERVER_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, index) => (index === 0 ? 4 : index))
const SERVER_KEY = btoa(String.fromCharCode(...SERVER_KEY_BYTES)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function fakeSubscription(endpoint: string, key: Uint8Array) {
  return {
    endpoint,
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
}

function stubBrowser(existing: ReturnType<typeof fakeSubscription> | null) {
  const created = fakeSubscription('https://fcm.googleapis.com/fcm/send/new', applicationServerKey(SERVER_KEY))
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(existing),
    subscribe: vi.fn().mockResolvedValue(created),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue({ active: {}, pushManager }) },
  })
  vi.stubGlobal('PushManager', function PushManager() {})
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() })
  return { pushManager, created }
}

describe('web push', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('decodes the base64url server key to the raw P-256 point', () => {
    const key = applicationServerKey(SERVER_KEY)
    expect(key).toHaveLength(65)
    expect(key[0]).toBe(4)
    expect(Array.from(key)).toEqual(Array.from(SERVER_KEY_BYTES))
  })

  it('subscribes with the server key and registers the subscription', async () => {
    const { pushManager, created } = stubBrowser(null)
    expect(webPushSupported()).toBe(true)

    await enableBrowserPush(SERVER_KEY, 'token-1')

    expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: applicationServerKey(SERVER_KEY) })
    expect(apiFetch).toHaveBeenCalledWith('/api/push/subscriptions', { method: 'POST', body: created.toJSON(), token: 'token-1' })
  })

  it('replaces a subscription made for another server key', async () => {
    const stale = fakeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array(65).fill(1))
    const { pushManager } = stubBrowser(stale)
    expect(await browserPushEnabled(SERVER_KEY)).toBe(false)

    await enableBrowserPush(SERVER_KEY, null)

    expect(stale.unsubscribe).toHaveBeenCalled()
    expect(pushManager.subscribe).toHaveBeenCalled()
  })

  it('tells the server before dropping the subscription and never throws', async () => {
    const current = fakeSubscription('https://fcm.googleapis.com/fcm/send/cur', applicationServerKey(SERVER_KEY))
    stubBrowser(current)
    expect(await browserPushEnabled(SERVER_KEY)).toBe(true)
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'))

    await expect(disableBrowserPush('token-2')).resolves.toBeUndefined()

    expect(apiFetch).toHaveBeenCalledWith('/api/push/subscriptions', { method: 'DELETE', body: { endpoint: current.endpoint }, token: 'token-2' })
    expect(current.unsubscribe).toHaveBeenCalled()
  })

  it('is unavailable without a push-capable service worker', async () => {
    vi.stubGlobal('Notification', { permission: 'granted' })
    expect(webPushSupported()).toBe(false)
    await expect(enableBrowserPush(SERVER_KEY, null)).rejects.toThrow('not available')
    await expect(disableBrowserPush(null)).resolves.toBeUndefined()
  })
})
