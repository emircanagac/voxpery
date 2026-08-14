export type DmNotificationAnchor = {
  channelId: string
  messageId: string | null
  notificationId: string
}

export type DmNotificationLocationState = {
  dmNotificationAnchor?: DmNotificationAnchor
}

export function readDmNotificationAnchor(state: unknown): DmNotificationAnchor | null {
  if (!state || typeof state !== 'object') return null
  const candidate = (state as DmNotificationLocationState).dmNotificationAnchor
  if (!candidate || typeof candidate !== 'object') return null
  if (typeof candidate.channelId !== 'string' || !candidate.channelId) return null
  if (candidate.messageId !== null && typeof candidate.messageId !== 'string') return null
  if (typeof candidate.notificationId !== 'string' || !candidate.notificationId) return null
  return candidate
}
