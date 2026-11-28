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

/**
 * Runs the sends queued under one key (a conversation) one after another, in queue order, so the
 * server stores messages in the order the user wrote them. A failed send does not hold back the
 * next one; every request has its own timeout, so none waits forever.
 */
export function createSendQueue() {
  const tails = new Map<string, Promise<void>>()
  return function enqueue<R>(key: string, task: () => Promise<R>): Promise<R> {
    const previous = tails.get(key) ?? Promise.resolve()
    const run = previous.then(task)
    const tail = run.then(() => undefined, () => undefined)
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return run
  }
}

/** One queue for every conversation of this tab: keys are `channel:<id>` and `dm:<id>`. */
export const enqueueMessageSend = createSendQueue()

/**
 * Moves the message at `index` to its place by `created_at` among the stored messages. Copies
 * still sending stay after it, so the conversation reads in server order while unsent messages
 * wait at the end.
 */
function placeByCreatedAt<T extends RetryableMessage>(messages: T[], index: number): T[] {
  const message = messages[index]
  const rest = messages.filter((_, i) => i !== index)
  const time = toTimestamp(message.created_at)
  const isLocal = (other: T) => other.clientStatus === 'sending' || other.clientStatus === 'failed'
  let position = rest.findIndex((other) => !isLocal(other) && toTimestamp(other.created_at) > time)
  if (position < 0) {
    position = rest.length
    while (position > 0 && isLocal(rest[position - 1])) position -= 1
  }
  while (position > 0 && rest[position - 1].clientStatus === 'sending') position -= 1
  return [...rest.slice(0, position), message, ...rest.slice(position)]
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

type IncomingMessage = RetryableMessage & {
  content: string
  attachments?: unknown
  author?: { user_id?: string } | null
}

function attachmentCount(attachments: unknown): number {
  return Array.isArray(attachments) ? attachments.length : 0
}

/**
 * Applies a `NewMessage` event to a conversation. A message from this user replaces only its own
 * optimistic copy: the one whose `clientId` the event echoes back, or, when the server sends no
 * request id, the oldest copy still sending with the same text and attachment count. Any other
 * message, including one sent from this user's other sessions, is added, so a slow request is
 * never mistaken for a later one and can still be marked as failed.
 */
export function applyIncomingMessage<T extends IncomingMessage>(
  current: T[],
  incoming: T,
  clientRequestId: string | null | undefined,
  currentUserId: string | null | undefined,
): T[] {
  const existingIdx = current.findIndex((message) => message.id === incoming.id)
  if (existingIdx >= 0) {
    const next = [...current]
    next[existingIdx] = incoming
    return next
  }

  const fromCurrentUser = !!currentUserId && incoming.author?.user_id === currentUserId
  if (fromCurrentUser) {
    const optimisticIdx = clientRequestId
      ? current.findIndex((message) => message.clientId === clientRequestId)
      : current.findIndex((message) => message.clientStatus === 'sending'
        && message.author?.user_id === currentUserId
        && message.content === incoming.content
        && attachmentCount(message.attachments) === attachmentCount(incoming.attachments))
    if (optimisticIdx >= 0) {
      const next = [...current]
      next[optimisticIdx] = incoming
      return placeByCreatedAt(next, optimisticIdx)
    }
  }

  return placeByCreatedAt([...current, incoming], current.length)
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
    return placeByCreatedAt(next, optimisticIdx)
  }

  return placeByCreatedAt([...current, confirmed], current.length)
}
