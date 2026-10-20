import type { Channel, DmChannel } from '../api'

/** Browser tab title: unread total first, then the open conversation. */
export function shellDocumentTitle(unreadCount: number, place?: string | null): string {
  const base = place ? `${place} | Voxpery` : 'Voxpery'
  if (unreadCount <= 0) return base
  return `(${unreadCount > 99 ? '99+' : unreadCount}) ${base}`
}

export function shellPlaceName({
  view,
  channel,
  dm,
}: {
  view: 'server' | 'dm' | 'friends' | 'other'
  channel?: Pick<Channel, 'name' | 'channel_type'> | null
  dm?: Pick<DmChannel, 'peer_username' | 'is_group' | 'name'> | null
}): string | null {
  if (view === 'server' && channel) return channel.channel_type === 'voice' ? channel.name : `#${channel.name}`
  if (view === 'dm' && dm) return dm.is_group ? (dm.name?.trim() || dm.peer_username) : `@${dm.peer_username}`
  if (view === 'friends') return 'Friends'
  return null
}
