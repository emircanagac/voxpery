import { useEffect, useRef, useState } from 'react'
import { Room, Track } from 'livekit-client'
import {
    updateVoiceDiagnostics,
    type ScreenShareOutboundDiagnostics,
} from '../voiceDiagnostics'

const PING_WINDOW_SIZE = 7
const RTC_BURST_SAMPLE_COUNT = 6
const RTC_BURST_INTERVAL_MS = 700
const RTC_STEADY_INTERVAL_MS = 2500
const WS_PING_INTERVAL_MS = 2500

type PingSource = 'rtc' | 'ws' | null

export interface ScreenShareOutboundSample extends ScreenShareOutboundDiagnostics {
    bytesSent?: number
    timestamp?: number
}

function finiteNumber(value: unknown): number | undefined {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
}

export function extractScreenShareOutboundSample(
    reports: RTCStats[],
    trackIdentifier: string,
): ScreenShareOutboundSample | null {
    const byId = new Map(reports.map((report) => [report.id, report]))
    const matches: ScreenShareOutboundSample[] = []
    for (const report of reports) {
        if (report.type !== 'outbound-rtp') continue
        const outbound = report as RTCOutboundRtpStreamStats & {
            mediaType?: string
            mediaSourceId?: string
            trackId?: string
            trackIdentifier?: string
            qualityLimitationReason?: string
            isRemote?: boolean
        }
        if ((outbound.kind ?? outbound.mediaType) !== 'video' || outbound.isRemote) continue

        const source = outbound.mediaSourceId ? byId.get(outbound.mediaSourceId) : undefined
        const legacyTrack = outbound.trackId ? byId.get(outbound.trackId) : undefined
        const sourceIdentifier = String(
            outbound.trackIdentifier
            ?? (source as (RTCStats & { trackIdentifier?: string }) | undefined)?.trackIdentifier
            ?? (legacyTrack as (RTCStats & { trackIdentifier?: string }) | undefined)?.trackIdentifier
            ?? '',
        )
        if (sourceIdentifier !== trackIdentifier) continue

        const remoteInbound = reports.find((candidate) => (
            candidate.type === 'remote-inbound-rtp'
            && (candidate as RTCStats & { localId?: string }).localId === outbound.id
        )) as (RTCStats & { packetsLost?: number }) | undefined

        matches.push({
            width: finiteNumber(outbound.frameWidth),
            height: finiteNumber(outbound.frameHeight),
            framesPerSecond: finiteNumber(outbound.framesPerSecond),
            packetsSent: finiteNumber(outbound.packetsSent),
            packetsLost: finiteNumber(remoteInbound?.packetsLost),
            qualityLimitationReason: outbound.qualityLimitationReason,
            bytesSent: finiteNumber(outbound.bytesSent),
            timestamp: finiteNumber(outbound.timestamp),
        })
    }
    if (matches.length === 0) return null

    const sum = (key: 'bytesSent' | 'packetsSent' | 'packetsLost') => {
        const values = matches.map((match) => match[key]).filter((value): value is number => value != null)
        return values.length > 0 ? values.reduce((total, value) => total + value, 0) : undefined
    }
    const max = (key: 'width' | 'height' | 'framesPerSecond' | 'timestamp') => {
        const values = matches.map((match) => match[key]).filter((value): value is number => value != null)
        return values.length > 0 ? Math.max(...values) : undefined
    }
    const limitation = matches
        .map((match) => match.qualityLimitationReason)
        .find((reason) => reason && reason !== 'none')
        ?? matches[0]?.qualityLimitationReason

    return {
        width: max('width'),
        height: max('height'),
        framesPerSecond: max('framesPerSecond'),
        packetsSent: sum('packetsSent'),
        packetsLost: sum('packetsLost'),
        qualityLimitationReason: limitation,
        bytesSent: sum('bytesSent'),
        timestamp: max('timestamp'),
    }
}

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value))

const median = (values: number[]): number | null => {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 1) return sorted[mid] ?? null
    const left = sorted[mid - 1]
    const right = sorted[mid]
    if (left == null || right == null) return null
    return (left + right) / 2
}

const averageAbsDelta = (values: number[]): number | null => {
    if (values.length < 2) return null
    let sum = 0
    for (let i = 1; i < values.length; i++) {
        const a = values[i - 1]
        const b = values[i]
        if (a == null || b == null) continue
        sum += Math.abs(b - a)
    }
    return sum / (values.length - 1)
}

const pushWindow = (target: number[], value: number, size: number) => {
    target.push(value)
    if (target.length > size) target.shift()
}

const smoothAsymmetric = (prev: number | null, next: number, riseAlpha: number, dropAlpha: number) => {
    if (prev == null) return next
    const alpha = next < prev ? dropAlpha : riseAlpha
    return Math.round(prev * (1 - alpha) + next * alpha)
}

const sanitizeRttMs = (raw: number): number | null => {
    if (!Number.isFinite(raw) || raw <= 0) return null
    const ms = raw <= 10 ? raw * 1000 : raw
    if (!Number.isFinite(ms) || ms <= 0) return null
    return clamp(Math.round(ms), 1, 5000)
}

interface InboundTotals {
    lost: number
    received: number
}

export function useWebrtcDiagnostics(options: {
    joinedChannelId: string | null
    isConnected: boolean
    roomRef: React.MutableRefObject<Room | null>
    roomState: string
    remoteStreamsVersion: number
    send: (type: string, data: unknown) => void
    subscribe: (cb: (evt: unknown) => void) => () => void
}) {
    const { joinedChannelId, isConnected, roomRef, roomState, remoteStreamsVersion, send, subscribe } = options

    const [pingMs, setPingMs] = useState<number | null>(null)
    const [wsPingMs, setWsPingMs] = useState<number | null>(null)
    const [rtcPingMs, setRtcPingMs] = useState<number | null>(null)
    const [packetLossPct, setPacketLossPct] = useState<number | null>(null)
    const [jitterMs, setJitterMs] = useState<number | null>(null)
    const [pingJitterMs, setPingJitterMs] = useState<number | null>(null)

    const wsSamplesRef = useRef<number[]>([])
    const rtcSamplesRef = useRef<number[]>([])
    const wsSmoothedRef = useRef<number | null>(null)
    const rtcSmoothedRef = useRef<number | null>(null)
    const wsPingJitterMsRef = useRef<number | null>(null)
    const rtcPingJitterMsRef = useRef<number | null>(null)
    const selectedPingSourceRef = useRef<PingSource>(null)
    const prevInboundTotalsRef = useRef<InboundTotals | null>(null)
    const previousScreenShareOutboundRef = useRef<ScreenShareOutboundSample | null>(null)

    // WS ping/pong — kept as fallback while RTC path is unavailable.
    useEffect(() => {
        if (!joinedChannelId || !isConnected) {
            wsSamplesRef.current = []
            wsSmoothedRef.current = null
            wsPingJitterMsRef.current = null
            return
        }

        let cancelled = false
        let timer: ReturnType<typeof window.setTimeout> | undefined
        let lastSentAt = 0

        const applyWsPing = (rawMs: number) => {
            const bounded = clamp(Math.round(rawMs), 1, 5000)
            pushWindow(wsSamplesRef.current, bounded, PING_WINDOW_SIZE)
            const target = median(wsSamplesRef.current) ?? bounded
            const smoothed = smoothAsymmetric(wsSmoothedRef.current, target, 0.3, 0.6)
            wsSmoothedRef.current = smoothed
            setWsPingMs(smoothed)

            const jitter = averageAbsDelta(wsSamplesRef.current)
            const rounded = jitter == null ? null : Math.round(jitter)
            wsPingJitterMsRef.current = rounded
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
            timer = window.setTimeout(tick, WS_PING_INTERVAL_MS)
        }

        tick()

        return () => {
            cancelled = true
            unsub()
            if (timer) window.clearTimeout(timer)
        }
    }, [isConnected, joinedChannelId, send, subscribe])

    // RTC diagnostics — authoritative for real voice path latency/quality.
    useEffect(() => {
        if (!joinedChannelId) {
            rtcSamplesRef.current = []
            rtcSmoothedRef.current = null
            rtcPingJitterMsRef.current = null
            prevInboundTotalsRef.current = null
            previousScreenShareOutboundRef.current = null
            return
        }

        let cancelled = false
        let timer: ReturnType<typeof window.setTimeout> | undefined
        let sampleCount = 0

        const readRttAndQuality = async (
            room: Room,
        ): Promise<{
            rttSamples: number[]
            inboundJitterSamples: number[]
            inboundTotals: InboundTotals
        }> => {
            const roomAny = room as unknown as {
                engine?: {
                    pcManager?: {
                        publisher?: { pc?: RTCPeerConnection }
                        subscriber?: { pc?: RTCPeerConnection }
                    }
                }
            }
            const candidatePcs: RTCPeerConnection[] = []
            const publisherPc = roomAny.engine?.pcManager?.publisher?.pc
            const subscriberPc = roomAny.engine?.pcManager?.subscriber?.pc
            if (publisherPc) candidatePcs.push(publisherPc)
            if (subscriberPc) candidatePcs.push(subscriberPc)

            const rttSamples: number[] = []
            const inboundJitterSamples: number[] = []
            const inboundTotals: InboundTotals = { lost: 0, received: 0 }

            for (const pc of candidatePcs) {
                try {
                    const stats = await pc.getStats()
                    const byId = new Map<string, RTCStats>()
                    stats.forEach((report) => {
                        if (report?.id) byId.set(report.id, report)
                    })

                    const screenPublication = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
                    const screenTrackIdentifier = screenPublication?.track?.mediaStreamTrack.id
                    if (screenTrackIdentifier) {
                        const sample = extractScreenShareOutboundSample(
                            Array.from(stats.values()),
                            screenTrackIdentifier,
                        )
                        if (sample) {
                            const previous = previousScreenShareOutboundRef.current
                            let bitrateKbps: number | undefined
                            if (
                                previous?.bytesSent != null
                                && previous.timestamp != null
                                && sample.bytesSent != null
                                && sample.timestamp != null
                                && sample.timestamp > previous.timestamp
                                && sample.bytesSent >= previous.bytesSent
                            ) {
                                bitrateKbps = Math.round(
                                    ((sample.bytesSent - previous.bytesSent) * 8)
                                    / (sample.timestamp - previous.timestamp),
                                )
                            }
                            previousScreenShareOutboundRef.current = sample
                            updateVoiceDiagnostics({
                                screenShareOutbound: {
                                    width: sample.width,
                                    height: sample.height,
                                    framesPerSecond: sample.framesPerSecond,
                                    bitrateKbps,
                                    packetsSent: sample.packetsSent,
                                    packetsLost: sample.packetsLost,
                                    qualityLimitationReason: sample.qualityLimitationReason,
                                },
                            })
                        }
                    } else {
                        previousScreenShareOutboundRef.current = null
                    }

                    // Transport-selected candidate pair (Chromium/WebKit).
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
                            const normalized = sanitizeRttMs(rttSec)
                            if (normalized != null) rttSamples.push(normalized)
                        }
                    })

                    // Candidate-pair fallback (Firefox/edge cases).
                    stats.forEach((report) => {
                        if (report.type !== 'candidate-pair') return
                        const pair = report as RTCIceCandidatePairStats & { nominated?: boolean; selected?: boolean }
                        const isSelected = pair.state === 'succeeded' && (pair.nominated || pair.selected)
                        if (!isSelected) return
                        let rttSec: number | null =
                            typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime : null
                        if (
                            rttSec == null &&
                            typeof pair.totalRoundTripTime === 'number' &&
                            typeof pair.responsesReceived === 'number' &&
                            pair.responsesReceived > 0
                        ) {
                            rttSec = pair.totalRoundTripTime / pair.responsesReceived
                        }
                        if (typeof rttSec === 'number') {
                            const normalized = sanitizeRttMs(rttSec)
                            if (normalized != null) rttSamples.push(normalized)
                        }
                    })

                    // Remote inbound RTP RTT fallback.
                    stats.forEach((report) => {
                        if (report.type !== 'remote-inbound-rtp') return
                        const rtp = report as RTCStats & { roundTripTime?: number }
                        if (typeof rtp.roundTripTime !== 'number') return
                        const normalized = sanitizeRttMs(rtp.roundTripTime)
                        if (normalized != null) rttSamples.push(normalized)
                    })

                    // Real-time quality metrics from inbound audio RTP.
                    stats.forEach((report) => {
                        if (report.type !== 'inbound-rtp') return
                        const inbound = report as RTCInboundRtpStreamStats & {
                            mediaType?: string
                            isRemote?: boolean
                        }
                        if (inbound.isRemote) return
                        const kind = inbound.kind ?? inbound.mediaType
                        if (kind !== 'audio') return

                        const packetsLost = Number(inbound.packetsLost ?? 0)
                        const packetsReceived = Number(inbound.packetsReceived ?? 0)
                        if (Number.isFinite(packetsLost)) inboundTotals.lost += packetsLost
                        if (Number.isFinite(packetsReceived)) inboundTotals.received += packetsReceived

                        const jitterSec = Number(inbound.jitter)
                        if (Number.isFinite(jitterSec) && jitterSec >= 0) {
                            inboundJitterSamples.push(jitterSec * 1000)
                        }
                    })
                } catch {
                    // ignore transient getStats failures
                }
            }

            return { rttSamples, inboundJitterSamples, inboundTotals }
        }

        const applyRtt = (samples: number[]) => {
            if (samples.length === 0) {
                // Keep last stable value while connected; avoid misleading HTTP/browser RTT fallback.
                if (roomState !== 'connected') {
                    setRtcPingMs(null)
                    rtcSamplesRef.current = []
                    rtcSmoothedRef.current = null
                    rtcPingJitterMsRef.current = null
                }
                return
            }

            const cycleMedian = median(samples) ?? samples[0] ?? null
            if (cycleMedian == null) return
            pushWindow(rtcSamplesRef.current, Math.round(cycleMedian), PING_WINDOW_SIZE)
            const windowMedian = median(rtcSamplesRef.current) ?? cycleMedian

            const prev = rtcSmoothedRef.current
            let nextTarget = Math.round(windowMedian)
            if (prev != null) {
                // Outlier guard: avoid huge single-jump increases/decreases.
                const maxRiseStep = 24
                const maxDropStep = 40
                const delta = nextTarget - prev
                if (delta > maxRiseStep) nextTarget = prev + maxRiseStep
                if (delta < -maxDropStep) nextTarget = prev - maxDropStep
            }

            const smoothed = smoothAsymmetric(prev, nextTarget, 0.28, 0.6)
            const bounded = clamp(smoothed, 1, 5000)
            rtcSmoothedRef.current = bounded
            setRtcPingMs(bounded)

            const jitter = averageAbsDelta(rtcSamplesRef.current)
            rtcPingJitterMsRef.current = jitter == null ? null : Math.round(jitter)
        }

        const applyQuality = (inboundJitterSamples: number[], inboundTotals: InboundTotals) => {
            const prevTotals = prevInboundTotalsRef.current
            prevInboundTotalsRef.current = inboundTotals

            if (prevTotals) {
                const deltaLost = inboundTotals.lost - prevTotals.lost
                const deltaReceived = inboundTotals.received - prevTotals.received
                const deltaPackets = deltaLost + deltaReceived
                if (deltaPackets > 0 && deltaLost >= 0) {
                    const intervalLossPct = clamp((deltaLost / deltaPackets) * 100, 0, 100)
                    const rounded = Number(intervalLossPct.toFixed(1))
                    setPacketLossPct((prev) =>
                        prev == null ? rounded : Number((prev * 0.55 + rounded * 0.45).toFixed(1)),
                    )
                }
            } else {
                const totalPackets = inboundTotals.lost + inboundTotals.received
                if (totalPackets > 0) {
                    const ratio = clamp((inboundTotals.lost / totalPackets) * 100, 0, 100)
                    setPacketLossPct(Number(ratio.toFixed(1)))
                }
            }

            if (inboundJitterSamples.length > 0) {
                const bounded = inboundJitterSamples
                    .map((value) => clamp(Math.round(value), 0, 1000))
                const medianJitter = median(bounded) ?? bounded[0] ?? null
                if (medianJitter != null) {
                    setJitterMs((prev) =>
                        prev == null
                            ? medianJitter
                            : Math.round(prev * 0.65 + medianJitter * 0.35),
                    )
                }
            } else if (roomState !== 'connected') {
                setJitterMs(null)
            }
        }

        const sample = async () => {
            if (cancelled) return
            const room = roomRef.current
            if (!room) {
                if (roomState !== 'connected') {
                    setRtcPingMs(null)
                    setPacketLossPct(null)
                    setJitterMs(null)
                }
            } else {
                const { rttSamples, inboundJitterSamples, inboundTotals } = await readRttAndQuality(room)
                if (cancelled) return
                applyRtt(rttSamples)
                applyQuality(inboundJitterSamples, inboundTotals)
            }

            sampleCount += 1
            const interval =
                sampleCount < RTC_BURST_SAMPLE_COUNT ? RTC_BURST_INTERVAL_MS : RTC_STEADY_INTERVAL_MS
            timer = window.setTimeout(() => {
                void sample()
            }, interval)
        }

        void sample()
        return () => {
            cancelled = true
            if (timer) window.clearTimeout(timer)
        }
    }, [joinedChannelId, roomRef, roomState, remoteStreamsVersion])

    // User-facing ping chooses the best source for perceived call quality.
    useEffect(() => {
        if (!joinedChannelId) {
            selectedPingSourceRef.current = null
            updateVoiceDiagnostics({
                network: {
                    pingMs: null,
                    wsPingMs: null,
                    rtcPingMs: null,
                    packetLossPct: null,
                    jitterMs: null,
                    pingJitterMs: null,
                    pingSource: null,
                },
            })
            return
        }

        const nextSource: PingSource =
            roomState === 'connected' && rtcPingMs != null
                ? 'rtc'
                : wsPingMs != null
                    ? 'ws'
                    : rtcPingMs != null
                        ? 'rtc'
                        : null

        if (nextSource == null) {
            selectedPingSourceRef.current = null
            return
        }

        const nextRaw = nextSource === 'rtc' ? rtcPingMs : wsPingMs
        if (nextRaw == null) {
            selectedPingSourceRef.current = null
            return
        }

        setPingMs((prev) => {
            if (prev == null || selectedPingSourceRef.current !== nextSource) {
                return nextRaw
            }
            const alpha = nextRaw < prev ? 0.55 : 0.3
            return Math.round(prev * (1 - alpha) + nextRaw * alpha)
        })

        setPingJitterMs(nextSource === 'rtc' ? rtcPingJitterMsRef.current : wsPingJitterMsRef.current)
        selectedPingSourceRef.current = nextSource
    }, [joinedChannelId, roomState, rtcPingMs, wsPingMs])

    useEffect(() => {
        if (!joinedChannelId) return
        updateVoiceDiagnostics({
            network: {
                pingMs,
                wsPingMs,
                rtcPingMs,
                packetLossPct,
                jitterMs,
                pingJitterMs,
                pingSource: selectedPingSourceRef.current,
            },
        })
    }, [joinedChannelId, jitterMs, packetLossPct, pingJitterMs, pingMs, rtcPingMs, wsPingMs])

    const hasActiveVoice = !!joinedChannelId
    const hasDisplaySource = hasActiveVoice && (rtcPingMs != null || wsPingMs != null)
    return {
        pingMs: hasDisplaySource ? pingMs : null,
        wsPingMs: hasActiveVoice ? wsPingMs : null,
        rtcPingMs: hasActiveVoice ? rtcPingMs : null,
        packetLossPct: hasActiveVoice ? packetLossPct : null,
        jitterMs: hasActiveVoice ? jitterMs : null,
        pingJitterMs: hasDisplaySource ? pingJitterMs : null,
    }
}
