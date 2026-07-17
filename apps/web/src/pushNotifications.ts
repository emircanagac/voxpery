const PUSH_KEY = 'voxpery-settings-push-enabled'
const PUSH_EXPLICIT_KEY = 'voxpery-settings-push-explicit'
const PUSH_PROMPT_SNOOZED_UNTIL_KEY = 'voxpery-push-prompt-snoozed-until'
const APP_ICON = '/1024.png'
export const PUSH_NOTIFICATION_STATE_CHANGED_EVENT = 'voxpery-push-notification-state-changed'
export const PUSH_NOTIFICATION_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

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

export function hasExplicitPushPreference(): boolean {
  try {
    return localStorage.getItem(PUSH_EXPLICIT_KEY) === '1'
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

export function getPushNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

export async function requestPushNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  const permission = await window.Notification.requestPermission()
  notifyPushNotificationStateChanged()
  return permission
}

export function shouldOfferPushNotificationPrompt(now = Date.now()): boolean {
  const permission = getPushNotificationPermission()
  if (permission !== 'default' || hasExplicitPushPreference()) return false
  try {
    const snoozedUntil = Number(localStorage.getItem(PUSH_PROMPT_SNOOZED_UNTIL_KEY) ?? '0')
    return !Number.isFinite(snoozedUntil) || snoozedUntil <= now
  } catch {
    return true
  }
}

export function snoozePushNotificationPrompt(
  now = Date.now(),
  durationMs = PUSH_NOTIFICATION_PROMPT_SNOOZE_MS,
): void {
  try {
    localStorage.setItem(PUSH_PROMPT_SNOOZED_UNTIL_KEY, String(now + durationMs))
  } catch {
    // ignore storage failures
  }
  notifyPushNotificationStateChanged()
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

export function showPushNotification({
  title,
  body,
  tag,
  onClick,
}: {
  title: string
  body: string
  tag?: string
  onClick?: () => void
}): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (window.Notification.permission !== 'granted') return

  const notification = new window.Notification(title, {
    body,
    tag,
    icon: APP_ICON,
    badge: APP_ICON,
    silent: true,
  })

  notification.onclick = () => {
    window.focus()
    onClick?.()
    notification.close()
  }
}
