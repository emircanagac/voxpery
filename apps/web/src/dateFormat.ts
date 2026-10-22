// The interface is English, so dates and times use one English format everywhere instead of the
// browser's locale ("Aug 8, 2026 06:09 PM", like message timestamps in chat).
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const TIME_FORMAT = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' })

function toValidDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "Aug 8, 2026", or an empty string for an invalid date. */
export function formatDate(value: Date | string | number): string {
  const date = toValidDate(value)
  return date ? DATE_FORMAT.format(date) : ''
}

/** "Aug 8, 2026 06:09 PM", or an empty string for an invalid date. */
export function formatDateTime(value: Date | string | number): string {
  const date = toValidDate(value)
  return date ? `${DATE_FORMAT.format(date)} ${TIME_FORMAT.format(date)}` : ''
}
