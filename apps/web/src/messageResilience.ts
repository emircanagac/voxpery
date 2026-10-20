type RetryableClientStatus = 'sending' | 'failed'

type RetryableMessage = {
  id: string
  created_at: string
  clientId?: string
  clientStatus?: RetryableClientStatus
  clientError?: string
  clientDraft?: string
}

const RECONNECT_RETRY_HINT = 'Connection changed while sending. Retry this message.'

/** A manual resend of the same text replaces the earlier failed attempt instead of duplicating it. */
export function withoutFailedDuplicates<T extends RetryableMessage & { content: string; attachments?: unknown }>(
  messages: T[],
  content: string,
  attachments: unknown,
): T[] {
  const attachmentKey = JSON.stringify(attachments ?? [])
  return messages.filter(message => !(message.clientStatus === 'failed'
    && message.content === content
    && JSON.stringify(message.attachments ?? []) === attachmentKey))
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function mergeRemoteWithRetryableLocals<T extends RetryableMessage>(remote: T[], local: T[]): T[] {
  const retryableLocals = local
    .filter((message) => message.clientId && (message.clientStatus === 'sending' || message.clientStatus === 'failed'))
    .map((message) => {
      if (message.clientStatus === 'sending') {
        return {
          ...message,
          clientStatus: 'failed' as const,
          clientError: message.clientError || RECONNECT_RETRY_HINT,
        }
      }
      return message
    })

  const merged = [...remote, ...retryableLocals]
  merged.sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at))
  return merged
}

/**
 * Merges the latest page into the cached conversation. When the page connects to the cached
 * messages, the older history the user already loaded is kept, so returning to a conversation
 * does not drop the place they were reading. A page that does not connect replaces the cache.
 */
export function mergeLatestPageWithHistory<T extends RetryableMessage>(latest: T[], cached: T[]): T[] {
  const merged = mergeRemoteWithRetryableLocals(latest, cached)
  const oldestLatestId = latest[0]?.id
  if (!oldestLatestId) return merged
  const overlap = cached.findIndex((message) => message.id === oldestLatestId)
  if (overlap <= 0) return merged
  const olderHistory = cached.slice(0, overlap).filter((message) => !message.clientId)
  return [...olderHistory, ...merged]
}

export function reconcileConfirmedMessage<T extends RetryableMessage>(
  current: T[],
  clientId: string,
  confirmed: T,
): T[] {
  const confirmedIdx = current.findIndex((message) => message.id === confirmed.id)
  const optimisticIdx = current.findIndex((message) => message.clientId === clientId)

  if (confirmedIdx >= 0 && optimisticIdx >= 0 && confirmedIdx !== optimisticIdx) {
    return current
      .filter((_, index) => index !== optimisticIdx)
      .map((message) => (message.id === confirmed.id ? confirmed : message))
  }

  if (confirmedIdx >= 0) {
    return current.map((message) => (message.id === confirmed.id ? confirmed : message))
  }

  if (optimisticIdx >= 0) {
    const next = [...current]
    next[optimisticIdx] = confirmed
    return next
  }

  return [...current, confirmed]
}
