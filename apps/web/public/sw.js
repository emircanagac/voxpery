const CACHE_NAME = 'voxpery-static-v3'
const PRECACHE_URLS = ['/manifest.webmanifest', '/pwa-192.png', '/pwa-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function isCacheableStaticAsset(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return false
  if (request.mode === 'navigate') return false
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return false
  if (url.pathname === '/' || url.pathname.endsWith('.html')) return false
  if (url.pathname === '/assets/rnnoise-worklet.js') return false

  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/pwa-192.png' ||
    url.pathname === '/pwa-512.png' ||
    url.pathname === '/pwa-maskable-512.png' ||
    url.pathname === '/1024.png' ||
    url.pathname === '/voxpery-logo.svg' ||
    url.pathname === '/favicon-32.png' ||
    url.pathname === '/apple-touch-icon.png'
  )
}

self.addEventListener('fetch', (event) => {
  if (!isCacheableStaticAsset(event.request)) return

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response
        }
        const responseToCache = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache))
        return response
      })
    }),
  )
})

// Must match NOTIFICATION_CLICK_MESSAGE and NOTIFICATION_TARGET_HASH in src/pushNotifications.ts.
const NOTIFICATION_CLICK_MESSAGE = 'voxpery-notification-click'
const NOTIFICATION_TARGET_HASH = '#notification='

function notificationTargetPath(target) {
  if (target && target.kind === 'dm') return '/social/dm'
  if (target && target.kind === 'server_channel') return '/servers'
  return '/social'
}

// A clicked notification brings an open Voxpery window forward and hands it the target; with no
// window open it starts one at the target. The page validates the target before using it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data
  const target = data && typeof data === 'object' ? data.target || null : null

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const sameOrigin = windows.filter((client) => new URL(client.url).origin === self.location.origin)
      const client = sameOrigin.find((candidate) => candidate.focused) || sameOrigin[0]
      if (client) {
        try {
          await client.focus()
        } catch {
          // Focusing can be refused; the window still gets the target.
        }
        if (target) client.postMessage({ type: NOTIFICATION_CLICK_MESSAGE, target })
        return
      }
      const hash = target ? NOTIFICATION_TARGET_HASH + encodeURIComponent(JSON.stringify(target)) : ''
      await self.clients.openWindow(notificationTargetPath(target) + hash)
    })(),
  )
})

// A push from the server (Web Push): it says who wrote and where, never the message itself.
// Every push shows a notification, as browsers require for push subscriptions.
function pushNotification(data) {
  const sender = data && typeof data.sender === 'string' ? data.sender.slice(0, 64) : 'Someone'
  if (data && data.type === 'mention' && data.server_id && data.channel_id) {
    return {
      title: sender,
      options: {
        body: 'mentioned you',
        tag: `server:${data.server_id}:channel:${data.channel_id}`,
        data: { target: { kind: 'server_channel', serverId: data.server_id, channelId: data.channel_id } },
      },
    }
  }
  if (data && data.type === 'dm' && data.channel_id) {
    return {
      title: sender,
      options: {
        body: 'sent you a direct message',
        tag: `dm:${data.channel_id}`,
        data: { target: { kind: 'dm', channelId: data.channel_id, messageId: null } },
      },
    }
  }
  return { title: 'Voxpery', options: { body: 'You have a new notification.', data: { target: null } } }
}

self.addEventListener('push', (event) => {
  let data = null
  try {
    data = event.data ? event.data.json() : null
  } catch {
    data = null
  }
  const { title, options } = pushNotification(data)
  event.waitUntil(
    self.registration.showNotification(title, {
      ...options,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
    }),
  )
})
