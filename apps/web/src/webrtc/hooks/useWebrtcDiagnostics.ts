import { useEffect, useState } from 'react'
import { Room } from 'livekit-client'

export function useWebrtcDiagnostics(options: {
    joinedChannelId: string | null
    isConnected: boolean
    roomRef: React.MutableRefObject<Room | null>
    roomState: string
    remoteStreamsVersion: number
    token: string | null
    send: (type: string, data: any) => void
    subscribe: (cb: (evt: unknown) => void) => () => void
}) {
    const { joinedChannelId, isConnected, roomRef, roomState, remoteStreamsVersion, token, send, subscribe } = options

    const [pingMs, setPingMs] = useState<number | null>(null)
    const [wsPingMs, setWsPingMs] = useState<number | null>(null)
    const [rtcPingMs, setRtcPingMs] = useState<number | null>(null)

    useEffect(() => {
        if (!joinedChannelId || !isConnected) {
            setWsPingMs(null)
            return
        }

        let cancelled = false
        let timer: ReturnType<typeof window.setTimeout>
        let lastSentAt = 0

        const applyWsPing = (rawMs: number) => {
            const bounded = Math.max(1, Math.min(5000, Math.round(rawMs)))
            setWsPingMs((prev) => {
                if (prev == null) return bounded
                if (bounded < prev) return Math.round(prev * 0.25 + bounded * 0.75)
                return Math.round(prev * 0.65 + bounded * 0.35)
            })
        }

        const unsub = subscribe((evt: unknown) => {
            if (cancelled) return
            const e = evt as { type?: string; data?: { sent_at_ms?: number } }
            if (e?.type !== 'Pong') return
            const sentAt = Number(e.data?.sent_at_ms)
            if (!Number.isFinite(sentAt) || sentAt <= 0) return
            if (sentAt !== lastSentAt) return
            const rtt = Date.now() - sentAt
            if (Number.isFinite(rtt) && rtt > 0) applyWsPing(rtt)
        })

        const tick = () => {
            if (cancelled) return
            lastSentAt = Date.now()
            send('Ping', { sent_at_ms: lastSentAt })
            timer = window.setTimeout(tick, 2500)
        }

        tick()

        return () => {
            cancelled = true
            unsub()
            window.clearTimeout(timer)
        }
    }, [isConnected, joinedChannelId, send, subscribe])

    useEffect(() => {
        if (!joinedChannelId) {
            setPingMs(null)
            return
        }
        setPingMs(wsPingMs ?? rtcPingMs)
    }, [joinedChannelId, rtcPingMs, wsPingMs])

    useEffect(() => {
        if (!joinedChannelId) {
            setRtcPingMs(null)
            return
        }

        let cancelled = false
        let timer: ReturnType<typeof window.setTimeout>
        const normalizeRttToMs = (value: number): number | null => {
            if (!Number.isFinite(value) || value <= 0) return null
            const ms = value <= 10 ? value * 1000 : value
            if (ms <= 0 || ms > 5000) return null
            return ms
        }

        const readRttSamples = async (room: Room): Promise<number[]> => {
            const roomAny = room as unknown as {
                engine?: {
                    pcManager?: {
                        publisher?: { pc?: RTCPeerConnection }
                        subscriber?: { pc?: RTCPeerConnection }
                    }
                }
            }
            const candidates: RTCPeerConnection[] = []
            const publisherPc = roomAny.engine?.pcManager?.publisher?.pc
            const subscriberPc = roomAny.engine?.pcManager?.subscriber?.pc
            if (publisherPc) candidates.push(publisherPc)
            if (subscriberPc) candidates.push(subscriberPc)
            if (candidates.length === 0) return []

            const samples: number[] = []
            for (const pc of candidates) {
                try {
                    const stats = await pc.getStats()
                    const byId = new Map<string, RTCStats>()
                    stats.forEach((report) => {
                        if (report?.id) byId.set(report.id, report)
                    })

                    stats.forEach((report) => {
                        if (report.type !== 'transport') return
                        const transport = report as RTCTransportStats & { selectedCandidatePairId?: string }
                        const selectedPairId = transport.selectedCandidatePairId
                        if (!selectedPairId) return
                        const pair = byId.get(selectedPairId)
                        if (!pair || pair.type !== 'candidate-pair') return
                        const cp = pair as RTCIceCandidatePairStats
                        let rttSec: number | null = typeof cp.currentRoundTripTime === 'number' ? cp.currentRoundTripTime : null
                        if (
                            rttSec == null &&
                            typeof cp.totalRoundTripTime === 'number' &&
                            typeof cp.responsesReceived === 'number' &&
                            cp.responsesReceived > 0
                        ) {
                            rttSec = cp.totalRoundTripTime / cp.responsesReceived
                        }
                        if (typeof rttSec === 'number') {
                            const normalized = normalizeRttToMs(rttSec)
                            if (normalized != null) samples.push(normalized)
                        }
                    })

                    stats.forEach((report) => {
                        if (report.type !== 'remote-inbound-rtp') return
                        const rtp = report as RTCStats & { roundTripTime?: number }
                        if (typeof rtp.roundTripTime !== 'number') return
                        const normalized = normalizeRttToMs(rtp.roundTripTime)
                        if (normalized != null) samples.push(normalized)
                    })
                } catch {
                    // ignore transient getStats failures
                }
            }

            return samples
        }

        const samplePing = async () => {
            if (cancelled) return

            const room = roomRef.current
            const samples = room ? await readRttSamples(room) : []

            if (cancelled) return

            if (samples.length > 0) {
                const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
                setRtcPingMs(avg)
            } else {
                const rttHint = Number((navigator as Navigator & { connection?: { rtt?: number } })?.connection?.rtt)
                if (Number.isFinite(rttHint) && rttHint > 0) {
                    setRtcPingMs(Math.round(rttHint))
                } else {
                    // Fallback HTTP Ping
                    const apiBase = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001'
                    const headers: Record<string, string> = {}
                    if (token) headers.Authorization = `Bearer ${token}`
                    const startedAt = performance.now()
                    try {
                        await fetch(`${apiBase}/api/auth/me`, {
                            method: 'GET',
                            headers,
                            credentials: 'include',
                            cache: 'no-store',
                        })
                        const elapsed = Math.round(performance.now() - startedAt)
                        if (elapsed > 0 && Number.isFinite(elapsed)) {
                            setRtcPingMs(elapsed)
                        } else if (roomState !== 'connected') {
                            setRtcPingMs(null)
                        }
                    } catch {
                        if (roomState !== 'connected') setRtcPingMs(null)
                    }
                }
            }

            timer = window.setTimeout(() => {
                void samplePing()
            }, 2500)
        }

        void samplePing()
        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [joinedChannelId, roomState, remoteStreamsVersion, token, roomRef])

    return { pingMs, wsPingMs, rtcPingMs }
}
