type RetryableClientStatus = 'sending' | 'failed'

type RetryableMessage = {
  id: string
  created_at: string
  clientId?: string
  clientStatus?: RetryableClientStatus
  clientError?: string
}

const RECONNECT_RETRY_HINT = 'Connection changed while sending. Retry this message.'

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
