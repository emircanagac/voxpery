import { useEffect, useState } from 'react'
import { formatDateTime } from './dateFormat'

/** Returns the end of a member timeout when it is still active. */
export function activeTimeoutUntil(until: string | null | undefined, now = Date.now()): Date | null {
  if (!until) return null
  const end = Date.parse(until)
  return Number.isFinite(end) && end > now ? new Date(end) : null
}

export function formatTimeoutUntil(date: Date): string {
  return formatDateTime(date)
}

/** "Timed out until …" for an active timeout, otherwise null. */
export function timeoutLabel(until: string | null | undefined, now = Date.now()): string | null {
  const end = activeTimeoutUntil(until, now)
  return end ? `Timed out until ${formatTimeoutUntil(end)}` : null
}

/** Browsers cap timers at about 24.8 days; a longer timeout re-arms the timer when it fires. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * Redraws the calling component once the timeout `until` ends, so an expired timeout badge does
 * not stay until something else redraws it.
 */
export function useTimeoutExpiryRerender(until: string | null | undefined): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const end = activeTimeoutUntil(until)
    if (!end) return
    const delay = Math.min(MAX_TIMER_MS, end.getTime() - Date.now() + 50)
    const timer = window.setTimeout(() => setTick((tick) => tick + 1), delay)
    return () => window.clearTimeout(timer)
  })
}
