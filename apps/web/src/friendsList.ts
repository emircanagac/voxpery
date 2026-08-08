import type { DmChannel, Friend } from './api'

export type FriendsFilter = 'all' | 'online' | 'requests'

const friendNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function normalizePresence(status?: string | null): 'online' | 'dnd' | 'offline' {
  const normalized = (status ?? 'offline').toLowerCase()
  if (normalized === 'online' || normalized === 'dnd') return normalized
  return 'offline'
}

export function isActiveFriend(friend: Pick<Friend, 'status'>): boolean {
  return normalizePresence(friend.status) !== 'offline'
}

function compareFriendNames(a: Pick<Friend, 'id' | 'username'>, b: Pick<Friend, 'id' | 'username'>): number {
  const byName = friendNameCollator.compare(a.username, b.username)
  if (byName !== 0) return byName
  return a.id.localeCompare(b.id)
}

export function compareFriendsForList(a: Friend, b: Friend): number {
  const aActive = isActiveFriend(a)
  const bActive = isActiveFriend(b)
  if (aActive !== bActive) return aActive ? -1 : 1
  return compareFriendNames(a, b)
}

export function getVisibleFriendsForFilter(friends: Friend[], filter: Exclude<FriendsFilter, 'requests'>): Friend[] {
  const source = filter === 'online' ? friends.filter(isActiveFriend) : friends
  return [...source].sort(compareFriendsForList)
}

function dmActivityTimestamp(channel: DmChannel): number {
  const timestamp = channel.last_message_at ? Date.parse(channel.last_message_at) : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function compareDmChannelsForList(a: DmChannel, b: DmChannel): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
  if (a.is_pinned && b.is_pinned) {
    const aPinnedAt = a.pinned_at ? Date.parse(a.pinned_at) : 0
    const bPinnedAt = b.pinned_at ? Date.parse(b.pinned_at) : 0
    const pinnedDiff = bPinnedAt - aPinnedAt
    if (Number.isFinite(pinnedDiff) && pinnedDiff !== 0) return pinnedDiff
    return a.id.localeCompare(b.id)
  }
  const activityDiff = dmActivityTimestamp(b) - dmActivityTimestamp(a)
  if (activityDiff !== 0) return activityDiff
  return a.id.localeCompare(b.id)
}

export function sortDmChannels(channels: DmChannel[]): DmChannel[] {
  return [...channels].sort(compareDmChannelsForList)
}

export function upsertDmChannel(channels: DmChannel[], channel: DmChannel): DmChannel[] {
  return sortDmChannels([channel, ...channels.filter((existing) => existing.id !== channel.id)])
}

export function touchDmChannelActivity(channels: DmChannel[], channelId: string, timestamp: string): DmChannel[] {
  return sortDmChannels(
    channels.map((channel) =>
      channel.id === channelId ? { ...channel, last_message_at: timestamp } : channel,
    ),
  )
}
