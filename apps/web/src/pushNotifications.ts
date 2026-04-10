const PUSH_KEY = 'voxpery-settings-push-enabled'
const PUSH_EXPLICIT_KEY = 'voxpery-settings-push-explicit'
const APP_ICON = '/1024.png'
const PERMISSION_PROMPTED_SESSION_KEY = 'voxpery-push-permission-prompted'

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
}

export function getPushNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

export async function requestPushNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.requestPermission()
}

export async function requestPushNotificationPermissionIfNeeded(): Promise<NotificationPermission | 'unsupported'> {
  const permission = getPushNotificationPermission()
  if (permission === 'unsupported' || permission === 'granted' || permission === 'denied') return permission
  if (!getPushNotificationsEnabled()) return permission
  try {
    if (sessionStorage.getItem(PERMISSION_PROMPTED_SESSION_KEY) === '1') return permission
  } catch {
    // ignore sessionStorage failures
  }
  const nextPermission = await requestPushNotificationPermission()
  try {
    if (nextPermission === 'default') sessionStorage.removeItem(PERMISSION_PROMPTED_SESSION_KEY)
    else sessionStorage.setItem(PERMISSION_PROMPTED_SESSION_KEY, '1')
  } catch {
    // ignore sessionStorage failures
  }
  return nextPermission
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
