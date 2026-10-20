import { formatTimeoutUntil } from './timeouts'

export interface SendErrorDescription {
  message: string
  /** False when retrying cannot succeed yet (for example while timed out). */
  retryable: boolean
}

const CONNECTION_MESSAGE = 'Message not sent. Check your connection and try again.'

/** Turns a failed send's raw API error into a short, user-facing explanation. */
export function describeSendError(raw: string | null | undefined): SendErrorDescription {
  const text = (raw ?? '').trim()
  const timeout = text.match(/timed out until (\S+)/i)
  if (timeout) {
    const end = Date.parse(timeout[1])
    return {
      message: Number.isFinite(end)
        ? `You are timed out until ${formatTimeoutUntil(new Date(end))}.`
        : 'You are timed out in this server.',
      retryable: false,
    }
  }
  if (!text || /^CONNECTION_ERROR:/.test(text) || /failed to fetch|network|did not respond/i.test(text)) {
    return { message: CONNECTION_MESSAGE, retryable: true }
  }
  const coded = text.match(/^[A-Z_]+:(.+)$/s)
  return { message: (coded ? coded[1] : text).trim() || CONNECTION_MESSAGE, retryable: true }
}
