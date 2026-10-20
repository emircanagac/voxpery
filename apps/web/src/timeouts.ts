/** Returns the end of a member timeout when it is still active. */
export function activeTimeoutUntil(until: string | null | undefined, now = Date.now()): Date | null {
  if (!until) return null
  const end = Date.parse(until)
  return Number.isFinite(end) && end > now ? new Date(end) : null
}

export function formatTimeoutUntil(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "Timed out until …" for an active timeout, otherwise null. */
export function timeoutLabel(until: string | null | undefined, now = Date.now()): string | null {
  const end = activeTimeoutUntil(until, now)
  return end ? `Timed out until ${formatTimeoutUntil(end)}` : null
}
