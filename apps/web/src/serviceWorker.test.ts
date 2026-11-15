import { describe, expect, it, vi } from 'vitest'
import swSource from '../public/sw.js?raw'

type Listener = (event: Record<string, unknown>) => void

/** Runs public/sw.js against a fake worker scope and returns its event listeners. */
function loadServiceWorker(clients: Record<string, unknown> = {}) {
  const listeners: Record<string, Listener> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const self = {
    addEventListener: (type: string, listener: Listener) => { listeners[type] = listener },
    registration: { showNotification },
    location: { origin: 'https://voxpery.test' },
    clients,
    skipWaiting: vi.fn(),
  }
  new Function('self', 'caches', 'fetch', swSource)(self, {}, vi.fn())
  return { listeners, showNotification }
}

function pushEvent(data: unknown) {
  let pending: Promise<unknown> = Promise.resolve()
  return {
    event: {
      data: data === undefined ? null : { json: () => data },
      waitUntil: (promise: Promise<unknown>) => { pending = promise },
    },
    done: () => pending,
  }
}

describe('service worker push', () => {
  it('shows a DM push with its target and without message text', async () => {
    const { listeners, showNotification } = loadServiceWorker()
    const push = pushEvent({ type: 'dm', sender: 'Ada', channel_id: 'dm-1' })
    listeners.push(push.event)
    await push.done()

    expect(showNotification).toHaveBeenCalledWith('Ada', expect.objectContaining({
      body: 'sent you a direct message',
      tag: 'dm:dm-1',
      data: { target: { kind: 'dm', channelId: 'dm-1', messageId: null } },
    }))
  })

  it('shows a mention push that opens the channel', async () => {
    const { listeners, showNotification } = loadServiceWorker()
    const push = pushEvent({ type: 'mention', sender: 'Ada', server_id: 's1', channel_id: 'c1' })
    listeners.push(push.event)
    await push.done()

    expect(showNotification).toHaveBeenCalledWith('Ada', expect.objectContaining({
      body: 'mentioned you',
      data: { target: { kind: 'server_channel', serverId: 's1', channelId: 'c1' } },
    }))
  })

  it('still shows a notification for a push it cannot read', async () => {
    const { listeners, showNotification } = loadServiceWorker()
    const push = pushEvent(undefined)
    listeners.push(push.event)
    await push.done()

    expect(showNotification).toHaveBeenCalledWith('Voxpery', expect.objectContaining({ data: { target: null } }))
  })

  it('opens a new window at the target when no Voxpery window is open', async () => {
    const openWindow = vi.fn().mockResolvedValue(null)
    const { listeners } = loadServiceWorker({ matchAll: vi.fn().mockResolvedValue([]), openWindow })
    let pending: Promise<unknown> = Promise.resolve()
    const target = { kind: 'dm', channelId: 'dm-1', messageId: null }
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { target } },
      waitUntil: (promise: Promise<unknown>) => { pending = promise },
    })
    await pending

    expect(openWindow).toHaveBeenCalledWith(`/social/dm#notification=${encodeURIComponent(JSON.stringify(target))}`)
  })
})
