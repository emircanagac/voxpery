import type { Channel, Friend, Server } from './api'
import { isActiveFriend } from './friendsList'

const VIEW_SERVER = 1 << 0

export interface SocialActivitySource {
  servers: Server[]
  channelsByServerId: Record<string, Channel[]>
  friends: Friend[]
  voiceStates: Record<string, string | null>
  voiceStateServerIds: Record<string, string | null>
  voiceControls: Record<string, { screenSharing: boolean }>
  voiceActivityConnectionIds?: Record<string, number>
}

export interface SocialActivityEntry {
  userId: string
  username: string
  avatarUrl: string | null
  server: Server
  channel: Channel
  screenSharing: boolean
}

export function getSocialActivity(source: SocialActivitySource, selfId: string | undefined, connectionId?: number) {
  if (!selfId) return []
  const servers = new Map(source.servers.map(server => [server.id, server]))
  const channels = new Map<string, { server: Server; channel: Channel }>()
  for (const [serverId, list] of Object.entries(source.channelsByServerId)) {
    const server = servers.get(serverId)
    if (!server) continue
    for (const channel of list) {
      if (channel.server_id !== serverId || channel.channel_type !== 'voice'
        || !((channel.my_permissions ?? 0) & VIEW_SERVER)) continue
      channels.set(channel.id, { server, channel })
    }
  }
  const friends = new Map(source.friends.map(friend => [friend.id, friend]))
  const inVoice: SocialActivityEntry[] = []
  for (const [userId, channelId] of Object.entries(source.voiceStates)) {
    if (userId === selfId || !channelId) continue
    const friend = friends.get(userId)
    if (!friend || !isActiveFriend(friend)) continue
    if (connectionId !== undefined && source.voiceActivityConnectionIds?.[userId] !== connectionId) continue
    const target = channels.get(channelId)
    if (!target) continue
    const voiceServerId = source.voiceStateServerIds[userId]
    if (voiceServerId && voiceServerId !== target.server.id) continue
    inVoice.push({
      ...target, userId,
      username: friend.username,
      avatarUrl: friend.avatar_url,
      screenSharing: !!source.voiceControls[userId]?.screenSharing,
    })
  }
  const compare = (a: SocialActivityEntry, b: SocialActivityEntry) =>
    a.username.localeCompare(b.username) || a.userId.localeCompare(b.userId)
  return inVoice.sort(compare)
}
