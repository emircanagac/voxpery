const CACHE_NAME = 'voxpery-static-v2'
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
    url.pathname === '/1024.png'
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
