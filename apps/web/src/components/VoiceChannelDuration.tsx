import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import { formatVoiceChannelDuration } from '../voiceChannelDuration'

export default function VoiceChannelDuration({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  // Only the counter rerenders each second; the channel/member list stays untouched.
  useEffect(() => {
    let interval: number | undefined
    const syncVisibility = () => {
      window.clearInterval(interval)
      if (document.hidden) return
      setNow(Date.now())
      interval = window.setInterval(() => setNow(Date.now()), 1000)
    }
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', syncVisibility)
    }
  }, [])

  const duration = formatVoiceChannelDuration(now - startedAt)
  const label = `Voice channel active for ${duration}`
  return <span className="channel-voice-duration" role="timer" aria-live="off" aria-label={label} title={label}>
    <Clock3 size={12} aria-hidden="true" /><span>{duration}</span>
  </span>
}
