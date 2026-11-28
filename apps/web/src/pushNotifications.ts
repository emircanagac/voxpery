import { isTauri } from './secureStorage'

const PUSH_KEY = 'voxpery-settings-push-enabled'
/** Event the desktop shell sends when a system notification is clicked; payload: the target JSON. */
const DESKTOP_NOTIFICATION_CLICK_EVENT = 'desktop-notification-click'
const PUSH_EXPLICIT_KEY = 'voxpery-settings-push-explicit'
const APP_ICON = '/pwa-192.png'
export const PUSH_NOTIFICATION_STATE_CHANGED_EVENT = 'voxpery-push-notification-state-changed'

function notifyPushNotificationStateChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PUSH_NOTIFICATION_STATE_CHANGED_EVENT))
}

export function getPushNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(PUSH_KEY) === '1'
  } catch {
    return false
  }
}

export function setPushNotificationsEnabled(enabled: boolean, explicit = false): void {
  try {
    localStorage.setItem(PUSH_KEY, enabled ? '1' : '0')
    if (explicit) localStorage.setItem(PUSH_EXPLICIT_KEY, '1')
  } catch {
    // ignore storage failures
  }
  notifyPushNotificationStateChanged()
}

// The desktop app shows notifications through the operating system (see showPushNotification),
// so it needs no webview permission: the in-app setting and the system's own notification
// settings decide. WebView2 would refuse the request without asking and remember the refusal.
export function getPushNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported'
  if (isTauri()) return 'granted'
  if (!('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

export async function requestPushNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined') return 'unsupported'
  if (isTauri()) {
    notifyPushNotificationStateChanged()
    return 'granted'
  }
  if (!('Notification' in window)) return 'unsupported'
  const permission = await window.Notification.requestPermission()
  notifyPushNotificationStateChanged()
  return permission
}

export function isAppBackgrounded(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  return document.hidden || !window.document.hasFocus()
}

export function shouldShowPushNotification(status: string | undefined): boolean {
  if (!getPushNotificationsEnabled()) return false
  const permission = getPushNotificationPermission()
  if (permission !== 'granted') return false
  if (!isAppBackgrounded()) return false
  return status !== 'dnd'
}

/** Where a notification leads when clicked. Plain data, so it survives the trip through a service worker. */
export type NotificationTarget =
  | { kind: 'server_channel'; serverId: string; channelId: string }
  | { kind: 'dm'; channelId: string; messageId: string | null }

/** `postMessage` type the service worker uses to hand a clicked notification to an open window. */
export const NOTIFICATION_CLICK_MESSAGE = 'voxpery-notification-click'
/** URL hash the service worker uses when it has to open a new window for a clicked notification. */
export const NOTIFICATION_TARGET_HASH = '#notification='
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

let targetHandler: ((target: NotificationTarget) => void) | null = null

/** Registers what a clicked notification does in this window; returns the function that removes it. */
export function setNotificationTargetHandler(handler: (target: NotificationTarget) => void): () => void {
  targetHandler = handler
  return () => {
    if (targetHandler === handler) targetHandler = null
  }
}

function openNotificationTarget(target: NotificationTarget): void {
  try {
    targetHandler?.(target)
  } catch (error) {
    console.error('Opening a notification failed', error)
  }
}

/** Accepts only the two target shapes with well-formed ids; anything else is ignored. */
export function parseNotificationTarget(value: unknown): NotificationTarget | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const isId = (id: unknown): id is string => typeof id === 'string' && ID_PATTERN.test(id)
  if (candidate.kind === 'server_channel' && isId(candidate.serverId) && isId(candidate.channelId)) {
    return { kind: 'server_channel', serverId: candidate.serverId, channelId: candidate.channelId }
  }
  if (candidate.kind === 'dm' && isId(candidate.channelId)) {
    const messageId = isId(candidate.messageId) ? candidate.messageId : null
    return { kind: 'dm', channelId: candidate.channelId, messageId }
  }
  return null
}

/**
 * Listens for notification clicks the service worker hands to this window, and opens the target a
 * newly opened window was started for. Call after `setNotificationTargetHandler`. Returns the
 * function that stops listening.
 */
export function listenForNotificationClicks(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (isTauri()) return listenForDesktopNotificationClicks()
  if (window.location.hash.startsWith(NOTIFICATION_TARGET_HASH)) {
    let target: NotificationTarget | null
    try {
      const encoded = window.location.hash.slice(NOTIFICATION_TARGET_HASH.length)
      target = parseNotificationTarget(JSON.parse(decodeURIComponent(encoded)))
    } catch {
      target = null
    }
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    if (target) openNotificationTarget(target)
  }
  if (!('serviceWorker' in navigator)) return () => {}
  const container = navigator.serviceWorker
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; target?: unknown } | null
    if (!data || data.type !== NOTIFICATION_CLICK_MESSAGE) return
    const target = parseNotificationTarget(data.target)
    if (target) openNotificationTarget(target)
  }
  container.addEventListener('message', onMessage)
  container.startMessages?.()
  return () => container.removeEventListener('message', onMessage)
}

/**
 * Shows the notification through the active service worker; Android Chrome allows notifications
 * only from there and throws on `new Notification`. Development builds and the desktop app have no
 * service worker and use `new Notification`. Never throws.
 */
async function showThroughServiceWorker(title: string, options: NotificationOptions): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false
    // `getRegistration` resolves at once; `ready` would wait forever without a registration.
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration?.active) return false
    await registration.showNotification(title, options)
    return true
  } catch {
    return false
  }
}

/** Desktop app: clicks on system notifications arrive as an event from the shell. */
function listenForDesktopNotificationClicks(): () => void {
  let stopped = false
  let unlisten: (() => void) | null = null
  void import('@tauri-apps/api/event')
    .then(({ listen }) => listen<string>(DESKTOP_NOTIFICATION_CLICK_EVENT, (event) => {
      let target: NotificationTarget | null
      try {
        target = parseNotificationTarget(JSON.parse(event.payload))
      } catch {
        target = null
      }
      if (target) openNotificationTarget(target)
    }))
    .then((stop) => {
      if (stopped) stop()
      else unlisten = stop
    })
    .catch(() => {
      // Without the event bridge a click still brings the window forward.
    })
  return () => {
    stopped = true
    unlisten?.()
  }
}

/** Desktop app: the shell shows a system notification; WebView2 would not show `new Notification`. */
function showOnDesktop(title: string, body: string, target: NotificationTarget | undefined): void {
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('desktop_show_notification', {
      title,
      body,
      target: target ? JSON.stringify(target) : null,
    }))
    .catch((error: unknown) => {
      console.warn('Desktop notification failed', error)
    })
}

function showInPage(title: string, options: NotificationOptions, target: NotificationTarget | undefined): void {
  try {
    const notification = new window.Notification(title, options)
    notification.onclick = () => {
      window.focus()
      notification.close()
      if (target) openNotificationTarget(target)
    }
  } catch {
    // Some browsers allow notifications only from a service worker; there is nothing else to try.
  }
}

export function showPushNotification({
  title,
  body,
  tag,
  target,
}: {
  title: string
  body: string
  tag?: string
  target?: NotificationTarget
}): void {
  if (typeof window === 'undefined') return
  if (isTauri()) {
    showOnDesktop(title, body, target)
    return
  }
  if (!('Notification' in window)) return
  if (window.Notification.permission !== 'granted') return

  const options: NotificationOptions = {
    body,
    tag,
    icon: APP_ICON,
    badge: APP_ICON,
    silent: true,
    data: { target: target ?? null },
  }
  void showThroughServiceWorker(title, options).then((shown) => {
    if (!shown) showInPage(title, options, target)
  })
}
