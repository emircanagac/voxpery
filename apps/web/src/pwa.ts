import { isTauri } from './secureStorage'

export function registerPwaServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (isTauri()) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA support should never block the authenticated app shell.
    })
  })
}
