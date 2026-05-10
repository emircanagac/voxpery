export type ServerNotificationPreference = 'all' | 'mentions' | 'none'

export const SERVER_NOTIFICATION_PREFERENCE_KEY = 'voxpery-settings-server-notification-mode'
export const DEFAULT_SERVER_NOTIFICATION_PREFERENCE: ServerNotificationPreference = 'mentions'

export const SERVER_NOTIFICATION_PREFERENCE_OPTIONS: Array<{
  value: ServerNotificationPreference
  label: string
  description: string
}> = [
  {
    value: 'mentions',
    label: 'Mentions only',
    description: 'Notify for @mentions and @everyone in server channels.',
  },
  {
    value: 'all',
    label: 'All messages',
    description: 'Notify for every unread server message unless the server or channel is muted.',
  },
  {
    value: 'none',
    label: 'Nothing',
    description: 'Never show server message notifications.',
  },
]

export function isServerNotificationPreference(value: unknown): value is ServerNotificationPreference {
  return value === 'all' || value === 'mentions' || value === 'none'
}

export function getServerNotificationPreference(): ServerNotificationPreference {
  try {
    const stored = localStorage.getItem(SERVER_NOTIFICATION_PREFERENCE_KEY)
    return isServerNotificationPreference(stored) ? stored : DEFAULT_SERVER_NOTIFICATION_PREFERENCE
  } catch {
    return DEFAULT_SERVER_NOTIFICATION_PREFERENCE
  }
}

export function setServerNotificationPreference(preference: ServerNotificationPreference): void {
  try {
    localStorage.setItem(SERVER_NOTIFICATION_PREFERENCE_KEY, preference)
  } catch {
    // ignore storage failures
  }
}

export function shouldTrackServerUnread({
  isMention,
  isMutedServer,
  isMutedChannel,
}: {
  isMention: boolean
  isMutedServer: boolean
  isMutedChannel: boolean
}): boolean {
  if (isMutedServer) return false
  if (isMutedChannel) return isMention
  return true
}

export function shouldNotifyForServerMessage({
  preference,
  isMention,
  isMutedServer,
  isMutedChannel,
}: {
  preference: ServerNotificationPreference
  isMention: boolean
  isMutedServer: boolean
  isMutedChannel: boolean
}): boolean {
  if (isMutedServer || preference === 'none') return false
  if (isMutedChannel && !isMention) return false
  if (preference === 'mentions' && !isMention) return false
  return true
}
