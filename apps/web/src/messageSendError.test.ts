import { describe, expect, it } from 'vitest'
import { describeSendError } from './messageSendError'
import { activeTimeoutUntil, formatTimeoutUntil, timeoutLabel } from './timeouts'

describe('describeSendError', () => {
  it('turns connection failures into a plain retryable message', () => {
    for (const raw of ['CONNECTION_ERROR:Cannot connect to the server. Failed to fetch', 'TypeError: Failed to fetch', undefined]) {
      expect(describeSendError(raw)).toEqual({ message: 'Message not sent. Check your connection and try again.', retryable: true })
    }
  })

  it('formats timeouts locally and does not offer a retry', () => {
    const until = '2026-10-17T19:30:40.542263+00:00'
    const result = describeSendError(`FORBIDDEN:You are timed out until ${until}`)
    expect(result.retryable).toBe(false)
    expect(result.message).toBe(`You are timed out until ${formatTimeoutUntil(new Date(Date.parse(until)))}.`)
    expect(result.message).not.toContain('T19:30')
  })

  it('drops error code prefixes from other server messages', () => {
    expect(describeSendError('FORBIDDEN:Slow mode is on')).toEqual({ message: 'Slow mode is on', retryable: true })
  })
})

describe('timeouts', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  it('only reports timeouts that have not ended', () => {
    expect(activeTimeoutUntil('2026-10-17T11:59:00Z', now)).toBeNull()
    expect(activeTimeoutUntil(null, now)).toBeNull()
    expect(activeTimeoutUntil('2026-10-17T12:30:00Z', now)?.toISOString()).toBe('2026-10-17T12:30:00.000Z')
    expect(timeoutLabel('2026-10-17T12:30:00Z', now)).toMatch(/^Timed out until /)
  })
})
