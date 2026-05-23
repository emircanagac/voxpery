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

export function upsertDmChannel(channels: DmChannel[], channel: DmChannel): DmChannel[] {
  return [channel, ...channels.filter((existing) => existing.id !== channel.id)]
}
