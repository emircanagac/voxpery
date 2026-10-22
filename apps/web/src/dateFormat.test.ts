import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from './dateFormat'

describe('dateFormat', () => {
  // Built from local parts so the expectation holds in any test time zone.
  const date = new Date(2026, 7, 8, 18, 9)

  it('formats dates in English regardless of the browser locale', () => {
    expect(formatDate(date)).toBe('Aug 8, 2026')
    expect(formatDateTime(date)).toBe('Aug 8, 2026 06:09 PM')
    expect(formatDateTime(date.toISOString())).toBe('Aug 8, 2026 06:09 PM')
  })

  it('returns an empty string for invalid dates', () => {
    expect(formatDate('not a date')).toBe('')
    expect(formatDateTime('')).toBe('')
  })
})
