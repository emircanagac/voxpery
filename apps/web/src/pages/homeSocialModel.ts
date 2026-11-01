import { normalizePresence } from '../friendsList'

export function presenceLabel(status?: string | null): string {
  const normalized = normalizePresence(status)
  if (normalized === 'dnd') return 'Do Not Disturb'
  if (normalized === 'offline') return 'Offline'
  return 'Online'
}

export type SocialContextMenu = {
  kind: 'friend' | 'dm' | 'group'
  userId: string
  username: string
  avatarUrl: string | null
  status: string | null
  channelId?: string
  x: number
  y: number
  trigger?: HTMLElement
  horizontalBoundary?: HTMLElement | null
}
