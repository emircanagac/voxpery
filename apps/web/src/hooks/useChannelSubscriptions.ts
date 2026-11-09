import { useEffect, useMemo, useRef } from 'react'

type Send = (type: string, data: unknown) => void

/**
 * Keeps the socket subscribed to exactly `channelIds`, sending `Subscribe` only for channels that
 * were added and `Unsubscribe` only for channels that went away. Re-subscribing everything on each
 * change made the server re-check every channel and resend voice snapshots, and events published
 * between the two messages were missed. A new connection starts without subscriptions, so the
 * whole list is subscribed again after a reconnect.
 */
export function useChannelSubscriptions(channelIds: readonly string[], isConnected: boolean, send: Send) {
  const subscribedRef = useRef<Set<string>>(new Set())
  const sendRef = useRef(send)
  sendRef.current = send
  // Order does not matter to the server: DM activity reorders the list without changing it.
  const key = useMemo(() => [...new Set(channelIds)].sort().join(','), [channelIds])

  useEffect(() => {
    if (!isConnected) {
      subscribedRef.current = new Set()
      return
    }
    const next = new Set(key ? key.split(',') : [])
    const current = subscribedRef.current
    const removed = [...current].filter((id) => !next.has(id))
    const added = [...next].filter((id) => !current.has(id))
    if (removed.length > 0) send('Unsubscribe', { channel_ids: removed })
    if (added.length > 0) send('Subscribe', { channel_ids: added })
    subscribedRef.current = next
  }, [key, isConnected, send])

  useEffect(() => () => {
    const current = subscribedRef.current
    if (current.size > 0) sendRef.current('Unsubscribe', { channel_ids: [...current] })
    subscribedRef.current = new Set()
  }, [])
}
