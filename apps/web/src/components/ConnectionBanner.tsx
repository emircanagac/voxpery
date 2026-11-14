import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { useSocketStore } from '../stores/socket'

/** A drop shorter than this heals without the user having to know about it. */
const SHOW_AFTER_MS = 3000

/**
 * Tells the user the realtime connection is down while the app keeps retrying. It never blocks
 * the page: everything already loaded stays usable.
 */
export default function ConnectionBanner() {
  const disconnectedSince = useSocketStore((s) => s.disconnectedSince)
  const resumeConnection = useSocketStore((s) => s.resumeConnection)
  // The outage the banner was last shown for; a new outage waits out the delay again.
  const [shownFor, setShownFor] = useState<number | null>(null)

  useEffect(() => {
    if (disconnectedSince === null) return
    const remaining = Math.max(0, SHOW_AFTER_MS - (Date.now() - disconnectedSince))
    const timer = window.setTimeout(() => setShownFor(disconnectedSince), remaining)
    return () => window.clearTimeout(timer)
  }, [disconnectedSince])

  if (disconnectedSince === null || shownFor !== disconnectedSince) return null

  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <WifiOff size={14} aria-hidden />
      <span>Connection lost. Reconnecting…</span>
      <button type="button" className="connection-banner-retry" onClick={resumeConnection}>
        Try now
      </button>
    </div>
  )
}
