import type { MessageWithAuthor } from './api'

export type CachedDmMessage = MessageWithAuthor & {
  clientId?: string
  clientStatus?: 'sending' | 'failed'
  clientError?: string
}

const MAX_CACHED_CONVERSATIONS = 16
const messageCache = new Map<string, CachedDmMessage[]>()
const inFlightLoads = new Map<string, Promise<CachedDmMessage[]>>()

function cacheKey(userId: string, channelId: string): string {
  return `${userId}:${channelId}`
}

export function getCachedDmMessages(userId: string, channelId: string): CachedDmMessage[] | undefined {
  const key = cacheKey(userId, channelId)
  const cached = messageCache.get(key)
  if (!cached) return undefined

  messageCache.delete(key)
  messageCache.set(key, cached)
  return cached
}

export function setCachedDmMessages(
  userId: string,
  channelId: string,
  messages: CachedDmMessage[],
): void {
  const key = cacheKey(userId, channelId)
  messageCache.delete(key)
  messageCache.set(key, messages)

  while (messageCache.size > MAX_CACHED_CONVERSATIONS) {
    const oldestKey = messageCache.keys().next().value
    if (!oldestKey) break
    messageCache.delete(oldestKey)
  }
}

export function loadDmMessagesOnce(
  userId: string,
  channelId: string,
  loader: () => Promise<MessageWithAuthor[]>,
): Promise<CachedDmMessage[]> {
  const key = cacheKey(userId, channelId)
  const existing = inFlightLoads.get(key)
  if (existing) return existing

  const request = loader()
    .then((rows) => rows.map((message) => ({
      ...message,
      clientId: undefined,
      clientStatus: undefined,
      clientError: undefined,
    })))
    .then((messages) => {
      setCachedDmMessages(userId, channelId, messages)
      return messages
    })
    .finally(() => {
      inFlightLoads.delete(key)
    })

  inFlightLoads.set(key, request)
  return request
}

export function clearDmMessageCacheForTests(): void {
  messageCache.clear()
  inFlightLoads.clear()
}
