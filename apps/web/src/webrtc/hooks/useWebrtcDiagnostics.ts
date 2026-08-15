import { useEffect, useRef, useState } from 'react'
import { Room, Track } from 'livekit-client'
import {
    updateVoiceDiagnostics,
    type ScreenShareAudioOutboundDiagnostics,
    type ScreenShareOutboundDiagnostics,
} from '../voiceDiagnostics'

const PING_WINDOW_SIZE = 7
const RTC_BURST_SAMPLE_COUNT = 6
const RTC_BURST_INTERVAL_MS = 700
const RTC_STEADY_INTERVAL_MS = 2500
const WS_PING_INTERVAL_MS = 2500
const PING_STALE_AFTER_MS = 7500
const MIN_RTC_SAMPLES_FOR_DISPLAY = 3

type PingSource = 'rtc' | 'ws' | null

export interface ScreenShareOutboundSample extends ScreenShareOutboundDiagnostics {
    bytesSent?: number
    timestamp?: number
}

export interface ScreenShareAudioOutboundSample extends ScreenShareAudioOutboundDiagnostics {
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

export function extractScreenShareAudioOutboundSample(
    reports: RTCStats[],
    trackIdentifier: string,
): ScreenShareAudioOutboundSample | null {
    const byId = new Map(reports.map((report) => [report.id, report]))
    for (const report of reports) {
        if (report.type !== 'outbound-rtp') continue
        const outbound = report as RTCOutboundRtpStreamStats & {
            mediaType?: string
            mediaSourceId?: string
            trackId?: string
            trackIdentifier?: string
            codecId?: string
            isRemote?: boolean
        }
        if ((outbound.kind ?? outbound.mediaType) !== 'audio' || outbound.isRemote) continue

        const source = outbound.mediaSourceId ? byId.get(outbound.mediaSourceId) : undefined
        const legacyTrack = outbound.trackId ? byId.get(outbound.trackId) : undefined
        const sourceIdentifier = String(
            outbound.trackIdentifier
            ?? (source as (RTCStats & { trackIdentifier?: string }) | undefined)?.trackIdentifier
            ?? (legacyTrack as (RTCStats & { trackIdentifier?: string }) | undefined)?.trackIdentifier
            ?? '',
        )
        if (sourceIdentifier !== trackIdentifier) continue

        const codec = outbound.codecId ? byId.get(outbound.codecId) : undefined
        const remoteInbound = reports.find((candidate) => (
            candidate.type === 'remote-inbound-rtp'
            && (candidate as RTCStats & { localId?: string }).localId === outbound.id
        )) as (RTCStats & { packetsLost?: number }) | undefined

        return {
            packetsSent: finiteNumber(outbound.packetsSent),
            packetsLost: finiteNumber(remoteInbound?.packetsLost),
            codec: (codec as (RTCStats & { mimeType?: string }) | undefined)?.mimeType,
            channels: finiteNumber((codec as (RTCStats & { channels?: number }) | undefined)?.channels),
            bytesSent: finiteNumber(outbound.bytesSent),
            timestamp: finiteNumber(outbound.timestamp),
        }
    }
    return null
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

const candidatePairRttMs = (pair: RTCStats | undefined): number | null => {
    if (!pair || pair.type !== 'candidate-pair') return null
    const candidatePair = pair as RTCIceCandidatePairStats
    let rttSeconds = typeof candidatePair.currentRoundTripTime === 'number'
        ? candidatePair.currentRoundTripTime
        : null
    if (
        rttSeconds == null
        && typeof candidatePair.totalRoundTripTime === 'number'
        && typeof candidatePair.responsesReceived === 'number'
        && candidatePair.responsesReceived > 0
    ) {
        rttSeconds = candidatePair.totalRoundTripTime / candidatePair.responsesReceived
    }
    return rttSeconds == null ? null : sanitizeRttMs(rttSeconds)
}

export function extractPeerConnectionRttMs(reports: RTCStats[]): number | null {
    const byId = new Map(reports.map((report) => [report.id, report]))
    const selectedTransportSamples: number[] = []

    for (const report of reports) {
        if (report.type !== 'transport') continue
        const selectedPairId = (report as RTCTransportStats & { selectedCandidatePairId?: string })
            .selectedCandidatePairId
        if (!selectedPairId) continue
        const sample = candidatePairRttMs(byId.get(selectedPairId))
        if (sample != null) selectedTransportSamples.push(sample)
    }
    if (selectedTransportSamples.length > 0) return median(selectedTransportSamples)

    const selectedPairSamples: number[] = []
    for (const report of reports) {
        if (report.type !== 'candidate-pair') continue
        const pair = report as RTCIceCandidatePairStats & { nominated?: boolean; selected?: boolean }
        if (pair.state !== 'succeeded' || (!pair.nominated && !pair.selected)) continue
        const sample = candidatePairRttMs(report)
        if (sample != null) selectedPairSamples.push(sample)
    }
    if (selectedPairSamples.length > 0) return median(selectedPairSamples)

    const remoteInboundSamples: number[] = []
    for (const report of reports) {
        if (report.type !== 'remote-inbound-rtp') continue
        const rttSeconds = (report as RTCStats & { roundTripTime?: number }).roundTripTime
        if (typeof rttSeconds !== 'number') continue
        const sample = sanitizeRttMs(rttSeconds)
        if (sample != null) remoteInboundSamples.push(sample)
    }
    return median(remoteInboundSamples)
}

export function stableRtcPingTarget(samples: number[]): number | null {
    if (samples.length < MIN_RTC_SAMPLES_FOR_DISPLAY) return null
    return median(samples)
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
    const wsSampleChannelRef = useRef<string | null>(null)
    const rtcSampleChannelRef = useRef<string | null>(null)
    const rtcLastSampleAtRef = useRef(0)
    const selectedPingSourceRef = useRef<PingSource>(null)
    const prevInboundTotalsRef = useRef<InboundTotals | null>(null)
    const previousScreenShareOutboundRef = useRef<ScreenShareOutboundSample | null>(null)
    const previousScreenShareAudioOutboundRef = useRef<ScreenShareAudioOutboundSample | null>(null)

    // WS ping/pong — kept as fallback while RTC path is unavailable.
    useEffect(() => {
        if (!joinedChannelId || !isConnected) {
            wsSamplesRef.current = []
            wsSmoothedRef.current = null
            wsPingJitterMsRef.current = null
            wsSampleChannelRef.current = null
            setWsPingMs(null)
            return
        }

        let cancelled = false
        let timer: ReturnType<typeof window.setTimeout> | undefined
        let lastSentAt = 0
        let lastPongAt = 0

        const applyWsPing = (rawMs: number) => {
            const bounded = clamp(Math.round(rawMs), 1, 5000)
            pushWindow(wsSamplesRef.current, bounded, PING_WINDOW_SIZE)
            const target = median(wsSamplesRef.current) ?? bounded
            const smoothed = smoothAsymmetric(wsSmoothedRef.current, target, 0.3, 0.6)
            wsSmoothedRef.current = smoothed
            wsSampleChannelRef.current = joinedChannelId
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
            if (Number.isFinite(rtt) && rtt > 0) {
                lastPongAt = Date.now()
                applyWsPing(rtt)
            }
        })

        const tick = () => {
            if (cancelled) return
            if (
                wsSampleChannelRef.current === joinedChannelId
                && lastPongAt > 0
                && Date.now() - lastPongAt >= PING_STALE_AFTER_MS
            ) {
                wsSampleChannelRef.current = null
                wsSamplesRef.current = []
                wsSmoothedRef.current = null
                wsPingJitterMsRef.current = null
                setWsPingMs(null)
            }
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
            rtcSampleChannelRef.current = null
            rtcLastSampleAtRef.current = 0
            prevInboundTotalsRef.current = null
            previousScreenShareOutboundRef.current = null
            setRtcPingMs(null)
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

                    const screenAudioPublication = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)
                    const screenAudioTrackIdentifier = screenAudioPublication?.track?.mediaStreamTrack.id
                    if (screenAudioTrackIdentifier) {
                        const sample = extractScreenShareAudioOutboundSample(
                            Array.from(stats.values()),
                            screenAudioTrackIdentifier,
                        )
                        if (sample) {
                            const previous = previousScreenShareAudioOutboundRef.current
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
                            previousScreenShareAudioOutboundRef.current = sample
                            updateVoiceDiagnostics({
                                screenShareAudioOutbound: {
                                    bitrateKbps,
                                    packetsSent: sample.packetsSent,
                                    packetsLost: sample.packetsLost,
                                    codec: sample.codec,
                                    channels: sample.channels,
                                },
                            })
                        }
                    } else {
                        previousScreenShareAudioOutboundRef.current = null
                        updateVoiceDiagnostics({ screenShareAudioOutbound: undefined })
                    }

                    const peerConnectionRtt = extractPeerConnectionRttMs(Array.from(stats.values()))
                    if (peerConnectionRtt != null) rttSamples.push(peerConnectionRtt)

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
                const lastSampleIsStale =
                    rtcLastSampleAtRef.current === 0
                    || Date.now() - rtcLastSampleAtRef.current >= PING_STALE_AFTER_MS
                if (roomState !== 'connected' || lastSampleIsStale) {
                    setRtcPingMs(null)
                    rtcSamplesRef.current = []
                    rtcSmoothedRef.current = null
                    rtcPingJitterMsRef.current = null
                    rtcSampleChannelRef.current = null
                    rtcLastSampleAtRef.current = 0
                }
                return
            }

            const cycleMedian = median(samples) ?? samples[0] ?? null
            if (cycleMedian == null) return
            pushWindow(rtcSamplesRef.current, Math.round(cycleMedian), PING_WINDOW_SIZE)
            rtcLastSampleAtRef.current = Date.now()
            const stableTarget = stableRtcPingTarget(rtcSamplesRef.current)
            if (stableTarget == null) {
                setRtcPingMs(null)
                return
            }
            const windowMedian = stableTarget

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
            rtcSampleChannelRef.current = joinedChannelId
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

        const currentRtcPingMs = rtcSampleChannelRef.current === joinedChannelId ? rtcPingMs : null
        const currentWsPingMs = wsSampleChannelRef.current === joinedChannelId ? wsPingMs : null
        const nextSource: PingSource =
            roomState === 'connected' && currentRtcPingMs != null
                ? 'rtc'
                : currentWsPingMs != null
                    ? 'ws'
                    : null

        if (nextSource == null) {
            selectedPingSourceRef.current = null
            setPingMs(null)
            setPingJitterMs(null)
            return
        }

        const nextRaw = nextSource === 'rtc' ? currentRtcPingMs : currentWsPingMs
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
    const currentRtcPingMs = rtcSampleChannelRef.current === joinedChannelId ? rtcPingMs : null
    const currentWsPingMs = wsSampleChannelRef.current === joinedChannelId ? wsPingMs : null
    const hasDisplaySource = hasActiveVoice && (currentRtcPingMs != null || currentWsPingMs != null)
    return {
        pingMs: hasDisplaySource ? pingMs : null,
        wsPingMs: hasActiveVoice ? currentWsPingMs : null,
        rtcPingMs: hasActiveVoice ? currentRtcPingMs : null,
        packetLossPct: hasActiveVoice ? packetLossPct : null,
        jitterMs: hasActiveVoice ? jitterMs : null,
        pingJitterMs: hasDisplaySource ? pingJitterMs : null,
    }
}
