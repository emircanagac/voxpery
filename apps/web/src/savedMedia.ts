import type { MessageWithAuthor } from './api'
import type { SavedMediaItem } from './types'

type SavedMediaSource =
  | {
      kind: 'server'
      serverId: string
      serverName: string
      channelId: string
      channelName: string
    }
  | {
      kind: 'dm'
      channelId: string
      channelName: string
      peerUserId: string | null
      peerUsername: string
    }

export function createSavedMediaId(source: 'server' | 'dm', messageId: string): string {
  return `${source}:${messageId}`
}

export function createSavedMediaItem(message: MessageWithAuthor, source: SavedMediaSource): SavedMediaItem {
  const base = {
    id: createSavedMediaId(source.kind, message.id),
    message_id: message.id,
    source: source.kind,
    channel_id: source.channelId,
    channel_name: source.channelName,
    author_username: message.author.username,
    content: message.content,
    attachments: Array.isArray(message.attachments) ? [...message.attachments] : [],
    created_at: message.created_at,
    saved_at: new Date().toISOString(),
  }

  if (source.kind === 'server') {
    return {
      ...base,
      server_id: source.serverId,
      server_name: source.serverName,
      peer_user_id: null,
      peer_username: null,
    }
  }

  return {
    ...base,
    server_id: null,
    server_name: null,
    peer_user_id: source.peerUserId,
    peer_username: source.peerUsername,
  }
}
