import { useCallback, useRef } from 'react'
import { createRnnoiseNode, type RnnoiseNode } from '../rnnoise'
import { getOrCreateAudioContext, playCueStack } from '../../audioCues'
import {
    getStoredVoiceInputProfile,
    getStoredVoiceSuppressionTuning,
    shouldUseAggressiveVoiceIsolation,
    type VoiceSuppressionTuning,
} from '../voiceInputProfile'

const SOUND_KEY = 'voxpery-settings-sound-enabled'
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'

function dbToLinear(db: number): number {
    return Math.pow(10, db / 20)
}

function pickSuppressionValue<T>(
    tuning: VoiceSuppressionTuning,
    values: { off: T; balanced: T; high: T },
): T {
    return values[tuning]
}

function getBandAverageDb(
    frequencyData: Float32Array,
    sampleRate: number,
    fftSize: number,
    minHz: number,
    maxHz: number,
): number {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || fftSize <= 0 || maxHz <= minHz) return -100
    const nyquist = sampleRate / 2
    const clampedMin = Math.max(0, Math.min(minHz, nyquist))
    const clampedMax = Math.max(clampedMin, Math.min(maxHz, nyquist))
    const binWidth = sampleRate / fftSize
    const start = Math.max(0, Math.floor(clampedMin / binWidth))
    const end = Math.min(frequencyData.length - 1, Math.ceil(clampedMax / binWidth))
    let sum = 0
    let count = 0
    for (let i = start; i <= end; i++) {
        const value = frequencyData[i]
        if (!Number.isFinite(value)) continue
        sum += value
        count++
    }
    return count > 0 ? sum / count : -100
}

function getSpeechIsolationTarget(
    frequencyData: Float32Array,
    sampleRate: number,
    fftSize: number,
    rms: number,
    lowFloorThr: number,
    openFloorThr: number,
    aggressiveIsolation: boolean,
): number {
    const presenceDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 220, 1500)
    const bodyDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 180, 2400)
    const upperSpeechDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 1600, 3400)
    const highNoiseDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 3400, 7200)
    const lowNoiseDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 0, 140)

    const speechLike =
        (presenceDb >= highNoiseDb - 3 && bodyDb >= highNoiseDb - 5)
        || upperSpeechDb >= highNoiseDb - 3.5
    const quietish = rms < openFloorThr * 1.35
    const boomyNoise = lowNoiseDb > bodyDb + 2.5
    const clickyNoise = highNoiseDb > presenceDb + 2.5

    if (!speechLike) {
        if (rms <= lowFloorThr || quietish) return aggressiveIsolation ? 0.035 : 0.16
        return clickyNoise || boomyNoise
            ? (aggressiveIsolation ? 0.08 : 0.24)
            : (aggressiveIsolation ? 0.14 : 0.3)
    }

    if (rms <= lowFloorThr) return aggressiveIsolation ? 0.14 : 0.28
    if (rms < openFloorThr) {
        const ratio = (rms - lowFloorThr) / Math.max(1e-6, openFloorThr - lowFloorThr)
        const eased = ratio * ratio * (3 - 2 * ratio)
        return aggressiveIsolation ? (0.28 + eased * 0.64) : (0.42 + eased * 0.5)
    }

    if (clickyNoise && quietish) return aggressiveIsolation ? 0.68 : 0.86
    return 1
}

function isLikelySpeechFrame(
    frequencyData: Float32Array,
    sampleRate: number,
    fftSize: number,
): boolean {
    const presenceDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 220, 1400)
    const speechBodyDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 180, 2200)
    const upperSpeechDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 1600, 3200)
    const highNoiseDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 2800, 7200)
    const lowNoiseDb = getBandAverageDb(frequencyData, sampleRate, fftSize, 0, 140)
    const score = Math.max(
        presenceDb - highNoiseDb,
        speechBodyDb - highNoiseDb + 0.8,
        upperSpeechDb - highNoiseDb - 0.6,
    )
    const clicky =
        highNoiseDb > presenceDb + 3.2
        && highNoiseDb > speechBodyDb + 4.2
        && lowNoiseDb < speechBodyDb - 6
    return score >= -2.8 && !clicky
}

export type VoiceCueKind = 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen'

interface LiveSuppressionConfig {
    aggressiveIsolation: boolean
    suppressionTuning: VoiceSuppressionTuning
    lowFloorThr: number
    openFloorThr: number
    minFloorGain: number
    floorReleaseAlpha: number
    floorReleaseTime: number
}

interface LiveSuppressionNodes {
    ctx: AudioContext
    highPassFilter: BiquadFilterNode
    lowPassFilter: BiquadFilterNode
    deClickFilter: BiquadFilterNode
    speechPresenceFilter: BiquadFilterNode
    transientCompressor: DynamicsCompressorNode
}

function buildSuppressionConfig(
    noiseSuppressionEnabled: boolean,
): LiveSuppressionConfig {
    const profile = getStoredVoiceInputProfile()
    const aggressiveIsolation = shouldUseAggressiveVoiceIsolation(profile, noiseSuppressionEnabled)
    const suppressionTuning = getStoredVoiceSuppressionTuning(noiseSuppressionEnabled)

    return {
        aggressiveIsolation,
        suppressionTuning,
        lowFloorThr: dbToLinear(aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: -51, balanced: -44, high: -40 })
            : pickSuppressionValue(suppressionTuning, { off: -51, balanced: -50, high: -46 })),
        openFloorThr: dbToLinear(aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: -40, balanced: -32, high: -29 })
            : pickSuppressionValue(suppressionTuning, { off: -40, balanced: -38, high: -34 })),
        minFloorGain: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.12, balanced: 0.025, high: 0.012 })
            : pickSuppressionValue(suppressionTuning, { off: 0.12, balanced: 0.1, high: 0.06 }),
        floorReleaseAlpha: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.08, balanced: 0.1, high: 0.12 })
            : pickSuppressionValue(suppressionTuning, { off: 0.08, balanced: 0.075, high: 0.09 }),
        floorReleaseTime: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.06, balanced: 0.052, high: 0.046 })
            : pickSuppressionValue(suppressionTuning, { off: 0.06, balanced: 0.066, high: 0.055 }),
    }
}

function applySuppressionConfig(
    nodes: LiveSuppressionNodes,
    config: LiveSuppressionConfig,
) {
    const { ctx, highPassFilter, lowPassFilter, deClickFilter, speechPresenceFilter, transientCompressor } = nodes
    const { aggressiveIsolation, suppressionTuning } = config
    const now = ctx.currentTime

    highPassFilter.frequency.setTargetAtTime(aggressiveIsolation ? 170 : 140, now, 0.03)
    lowPassFilter.frequency.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 7200, balanced: 4100, high: 3500 })
            : pickSuppressionValue(suppressionTuning, { off: 7200, balanced: 5200, high: 4400 }),
        now,
        0.03,
    )
    deClickFilter.gain.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0, balanced: -8.5, high: -10 })
            : pickSuppressionValue(suppressionTuning, { off: 0, balanced: -2.75, high: -4.2 }),
        now,
        0.03,
    )
    speechPresenceFilter.gain.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0, balanced: 1.6, high: 1.9 })
            : pickSuppressionValue(suppressionTuning, { off: 0, balanced: 1.4, high: 1.75 }),
        now,
        0.04,
    )
    transientCompressor.threshold.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: -30, balanced: -40, high: -44 })
            : pickSuppressionValue(suppressionTuning, { off: -30, balanced: -32, high: -36 }),
        now,
        0.03,
    )
    transientCompressor.knee.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 10, balanced: 6, high: 5 })
            : pickSuppressionValue(suppressionTuning, { off: 10, balanced: 10, high: 8 }),
        now,
        0.03,
    )
    transientCompressor.ratio.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 3.5, balanced: 7.2, high: 8.2 })
            : pickSuppressionValue(suppressionTuning, { off: 3.5, balanced: 4.2, high: 5.4 }),
        now,
        0.03,
    )
    transientCompressor.attack.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.003, balanced: 0.0012, high: 0.001 })
            : pickSuppressionValue(suppressionTuning, { off: 0.003, balanced: 0.0018, high: 0.0015 }),
        now,
        0.02,
    )
    transientCompressor.release.setTargetAtTime(
        aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.085, balanced: 0.045, high: 0.038 })
            : pickSuppressionValue(suppressionTuning, { off: 0.085, balanced: 0.08, high: 0.065 }),
        now,
        0.03,
    )
}

export function useAudioEngine() {
    const audioCtxRef = useRef<AudioContext | null>(null)
    const liveSuppressionConfigRef = useRef<LiveSuppressionConfig | null>(null)
    const liveSuppressionNodesRef = useRef<LiveSuppressionNodes | null>(null)
    const liveSuppressionSignatureRef = useRef<string | null>(null)

    const isSoundEnabled = useCallback(() => localStorage.getItem(SOUND_KEY) !== '0', [])

    const getAudioContext = useCallback((): AudioContext | null => {
        return getOrCreateAudioContext(audioCtxRef)
    }, [])

    const playVoiceCue = useCallback((kind: VoiceCueKind) => {
        if (!isSoundEnabled()) return
        const ctx = getAudioContext()
        if (!ctx) return

        switch (kind) {
            case 'join':
                playCueStack(ctx, [
                    { from: 520, to: 620, durationSec: 0.1, peak: 0.016, type: 'sine', overtoneGain: 0.07, filterHz: 1600 },
                    { from: 760, to: 900, offsetSec: 0.08, durationSec: 0.12, peak: 0.013, type: 'triangle', overtoneGain: 0.1, filterHz: 2200 },
                ])
                break
            case 'leave':
                playCueStack(ctx, [
                    { from: 760, to: 620, durationSec: 0.1, peak: 0.015, type: 'sine', overtoneGain: 0.06, filterHz: 1700 },
                    { from: 480, to: 380, offsetSec: 0.08, durationSec: 0.125, peak: 0.012, type: 'triangle', overtoneGain: 0.08, filterHz: 1500 },
                ])
                break
            case 'mute':
                playCueStack(ctx, [
                    { from: 520, to: 410, durationSec: 0.085, peak: 0.02, type: 'triangle', overtoneGain: 0.14, filterHz: 1700, q: 1.1 },
                ])
                break
            case 'unmute':
                playCueStack(ctx, [
                    { from: 390, to: 560, durationSec: 0.09, peak: 0.022, type: 'triangle', overtoneGain: 0.18, filterHz: 2200, q: 0.9 },
                ])
                break
            case 'deafen':
                playCueStack(ctx, [
                    { from: 480, to: 360, durationSec: 0.08, peak: 0.019, type: 'triangle', overtoneGain: 0.12, filterHz: 1600, q: 1.2 },
                    { from: 300, to: 230, offsetSec: 0.07, durationSec: 0.105, peak: 0.016, type: 'sine', overtoneGain: 0.06, filterHz: 1100, q: 0.8 },
                ])
                break
            case 'undeafen':
                playCueStack(ctx, [
                    { from: 270, to: 340, durationSec: 0.08, peak: 0.018, type: 'sine', overtoneGain: 0.08, filterHz: 1400, q: 0.8 },
                    { from: 430, to: 640, offsetSec: 0.065, durationSec: 0.11, peak: 0.024, type: 'triangle', overtoneGain: 0.2, filterHz: 2400, q: 0.9 },
                ])
                break
        }
    }, [getAudioContext, isSoundEnabled])

    const disconnectAudioContext = useCallback(() => {
        if (audioCtxRef.current) {
            if (audioCtxRef.current.state !== 'closed') {
                // Optionally close the entire context when leaving, depending on architectural choice.
                // Usually audio contexts can stay alive or suspended. We'll leave it alive for rapid re-joins.
            }
        }
    }, [])

    // Build the mic send pipeline:
    // source -> speech-focused filtering -> [RNNoise] -> keyboard transient tamer -> noise floor tamer -> volume -> destination.
    const rnnoiseRef = useRef<RnnoiseNode | null>(null)

    const buildMicSendTrack = useCallback(async (
        sourceStream: MediaStream,
        volumeFactor: number,
        muted: boolean,
        rawMicTrackRef: React.MutableRefObject<MediaStreamTrack | null>,
        inputGainNodeRef: React.MutableRefObject<GainNode | null>,
        noiseSuppressionEnabled: boolean,
    ): Promise<{ track: MediaStreamTrack; vadStream: MediaStream; cancelGate: () => void }> => {
        const rawTrack = sourceStream.getAudioTracks()[0]
        if (!rawTrack) throw new Error('No microphone track available')

        rawMicTrackRef.current = rawTrack
        rawTrack.enabled = !muted

        const ctx = getAudioContext()
        if (!ctx) return { track: rawTrack, vadStream: sourceStream, cancelGate: () => {} }
        if (ctx.state === 'suspended') {
            await ctx.resume()
        }

        const source = ctx.createMediaStreamSource(sourceStream)
        const suppressionConfig = buildSuppressionConfig(noiseSuppressionEnabled)
        const { aggressiveIsolation, suppressionTuning } = suppressionConfig
        const highPassFilter = ctx.createBiquadFilter()
        highPassFilter.type = 'highpass'
        highPassFilter.Q.value = 0.9
        const lowPassFilter = ctx.createBiquadFilter()
        lowPassFilter.type = 'lowpass'
        lowPassFilter.Q.value = 0.8
        const deClickFilter = ctx.createBiquadFilter()
        deClickFilter.type = 'highshelf'
        deClickFilter.frequency.value = 3200
        const speechPresenceFilter = ctx.createBiquadFilter()
        speechPresenceFilter.type = 'peaking'
        speechPresenceFilter.frequency.value = 1850
        speechPresenceFilter.Q.value = 1.05
        const speechIsolationGainNode = ctx.createGain()
        speechIsolationGainNode.gain.value = 1

        // RNNoise ML denoiser (bypasses transparently when disabled)
        rnnoiseRef.current?.destroy()
        const rnnoise = await createRnnoiseNode(ctx, noiseSuppressionEnabled)
        rnnoiseRef.current = rnnoise

        // Tame sharp keyboard peaks before the final send gain.
        const transientCompressor = ctx.createDynamicsCompressor()

        const noiseFloorGainNode = ctx.createGain()
        noiseFloorGainNode.gain.value = 1
        const volumeGainNode = ctx.createGain()
        volumeGainNode.gain.value = volumeFactor
        const destination = ctx.createMediaStreamDestination()

        // VAD tap: post-RNNoise, pre-volume — speaking indicator reflects
        // the denoised signal so background noise won't light up the ring.
        const vadDestination = ctx.createMediaStreamDestination()
        const refinementAnalyser = ctx.createAnalyser()
        refinementAnalyser.fftSize = 256
        refinementAnalyser.smoothingTimeConstant = 0.88

        source.connect(highPassFilter)
        highPassFilter.connect(rnnoise.node)
        rnnoise.node.connect(lowPassFilter)
        lowPassFilter.connect(deClickFilter)
        deClickFilter.connect(refinementAnalyser)
        deClickFilter.connect(speechPresenceFilter)
        speechPresenceFilter.connect(speechIsolationGainNode)
        speechIsolationGainNode.connect(transientCompressor)
        transientCompressor.connect(noiseFloorGainNode)
        noiseFloorGainNode.connect(vadDestination) // branch for VAD after final floor suppression
        noiseFloorGainNode.connect(volumeGainNode)
        volumeGainNode.connect(destination)

        const liveSuppressionNodes = {
            ctx,
            highPassFilter,
            lowPassFilter,
            deClickFilter,
            speechPresenceFilter,
            transientCompressor,
        }
        applySuppressionConfig(liveSuppressionNodes, suppressionConfig)
        liveSuppressionNodesRef.current = liveSuppressionNodes
        liveSuppressionConfigRef.current = suppressionConfig
        liveSuppressionSignatureRef.current = `${noiseSuppressionEnabled}:${aggressiveIsolation}:${suppressionTuning}`

        const processedTrack = destination.stream.getAudioTracks()[0]
        if (!processedTrack) return { track: rawTrack, vadStream: sourceStream, cancelGate: () => {} }

        inputGainNodeRef.current = volumeGainNode
        const analyserBuffer = new Float32Array(Math.max(128, refinementAnalyser.frequencyBinCount, refinementAnalyser.fftSize))
        const frequencyBuffer = new Float32Array(Math.max(32, refinementAnalyser.frequencyBinCount))
        let rafId: number | null = null
        let currentFloorGain = 1
        let currentIsolationGain = 1

        const cancelGate = () => {
            if (rafId != null) {
                cancelAnimationFrame(rafId)
                rafId = null
            }
            currentFloorGain = 1
            currentIsolationGain = 1
            liveSuppressionNodesRef.current = null
            liveSuppressionConfigRef.current = null
            liveSuppressionSignatureRef.current = null
            try {
                noiseFloorGainNode.gain.cancelScheduledValues(ctx.currentTime)
                noiseFloorGainNode.gain.setValueAtTime(1, ctx.currentTime)
            } catch {
                noiseFloorGainNode.gain.value = 1
            }
            try {
                speechIsolationGainNode.gain.cancelScheduledValues(ctx.currentTime)
                speechIsolationGainNode.gain.setValueAtTime(1, ctx.currentTime)
            } catch {
                speechIsolationGainNode.gain.value = 1
            }
            try {
                source.disconnect()
            } catch {
                // ignore
            }
            try {
                highPassFilter.disconnect()
            } catch {
                // ignore
            }
            try {
                deClickFilter.disconnect(refinementAnalyser)
            } catch {
                // ignore
            }
            try {
                noiseFloorGainNode.disconnect(vadDestination)
            } catch {
                // ignore
            }
            try {
                deClickFilter.disconnect(transientCompressor)
            } catch {
                // ignore
            }
            try {
                deClickFilter.disconnect(speechPresenceFilter)
            } catch {
                // ignore
            }
            try {
                rnnoise.node.disconnect(lowPassFilter)
            } catch {
                // ignore
            }
            try {
                lowPassFilter.disconnect(deClickFilter)
            } catch {
                // ignore
            }
            try {
                deClickFilter.disconnect()
            } catch {
                // ignore
            }
            try {
                speechPresenceFilter.disconnect()
            } catch {
                // ignore
            }
            try {
                speechIsolationGainNode.disconnect()
            } catch {
                // ignore
            }
            try {
                transientCompressor.disconnect()
            } catch {
                // ignore
            }
            try {
                noiseFloorGainNode.disconnect()
            } catch {
                // ignore
            }
            try {
                volumeGainNode.disconnect()
            } catch {
                // ignore
            }
        }

        const tickNoiseFloor = () => {
            try {
                refinementAnalyser.getFloatTimeDomainData(analyserBuffer)
                refinementAnalyser.getFloatFrequencyData(frequencyBuffer)
                let sum = 0
                for (let i = 0; i < analyserBuffer.length; i++) sum += analyserBuffer[i] * analyserBuffer[i]
                const rms = Math.sqrt(sum / analyserBuffer.length)
                const refinementEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
                const liveSuppressionConfig = liveSuppressionConfigRef.current ?? suppressionConfig
                let targetGain = 1
                let targetIsolationGain = 1

                if (refinementEnabled) {
                    if (rms <= liveSuppressionConfig.lowFloorThr) {
                        targetGain = liveSuppressionConfig.minFloorGain
                    } else if (rms < liveSuppressionConfig.openFloorThr) {
                        const ratio = (rms - liveSuppressionConfig.lowFloorThr) / (liveSuppressionConfig.openFloorThr - liveSuppressionConfig.lowFloorThr)
                        const eased = ratio * ratio * (3 - 2 * ratio)
                        targetGain = liveSuppressionConfig.minFloorGain + eased * (1 - liveSuppressionConfig.minFloorGain)
                    }
                    targetIsolationGain = getSpeechIsolationTarget(
                        frequencyBuffer,
                        ctx.sampleRate,
                        refinementAnalyser.fftSize,
                        rms,
                        liveSuppressionConfig.lowFloorThr,
                        liveSuppressionConfig.openFloorThr,
                        liveSuppressionConfig.aggressiveIsolation,
                    )
                    const likelySpeech = isLikelySpeechFrame(
                        frequencyBuffer,
                        ctx.sampleRate,
                        refinementAnalyser.fftSize,
                    )
                    // When we detect speech, avoid over-attenuating the send floor.
                    // This keeps syllables intact while retaining strong suppression in non-speech frames.
                    if (likelySpeech) {
                        const speechSafeFloor = liveSuppressionConfig.aggressiveIsolation ? 0.72 : 0.8
                        targetGain = Math.max(targetGain, speechSafeFloor)
                    }
                }

                const alpha = targetGain > currentFloorGain ? 0.38 : liveSuppressionConfig.floorReleaseAlpha
                currentFloorGain = alpha * targetGain + (1 - alpha) * currentFloorGain
                noiseFloorGainNode.gain.setTargetAtTime(
                    currentFloorGain,
                    ctx.currentTime,
                    targetGain > currentFloorGain ? 0.016 : liveSuppressionConfig.floorReleaseTime,
                )
                const isolationAlpha = targetIsolationGain > currentIsolationGain
                    ? 0.22
                    : (liveSuppressionConfig.aggressiveIsolation ? 0.2 : 0.14)
                currentIsolationGain = isolationAlpha * targetIsolationGain + (1 - isolationAlpha) * currentIsolationGain
                speechIsolationGainNode.gain.setTargetAtTime(
                    currentIsolationGain,
                    ctx.currentTime,
                    targetIsolationGain > currentIsolationGain ? 0.03 : 0.06,
                )
            } catch {
                // ignore
            }
            rafId = requestAnimationFrame(tickNoiseFloor)
        }

        rafId = requestAnimationFrame(tickNoiseFloor)

        return { track: processedTrack, vadStream: vadDestination.stream, cancelGate }
    }, [getAudioContext])

    const updateMicProcessingSettings = useCallback((noiseSuppressionEnabled: boolean) => {
        rnnoiseRef.current?.setEnabled(noiseSuppressionEnabled)

        const nodes = liveSuppressionNodesRef.current
        if (!nodes) return false

        const nextConfig = buildSuppressionConfig(noiseSuppressionEnabled)
        const nextSignature = `${noiseSuppressionEnabled}:${nextConfig.aggressiveIsolation}:${nextConfig.suppressionTuning}`
        if (liveSuppressionSignatureRef.current === nextSignature) {
            return true
        }

        applySuppressionConfig(nodes, nextConfig)
        liveSuppressionConfigRef.current = nextConfig
        liveSuppressionSignatureRef.current = nextSignature
        return true
    }, [])

    const destroyRnnoise = useCallback(() => {
        rnnoiseRef.current?.destroy()
        rnnoiseRef.current = null
        liveSuppressionNodesRef.current = null
        liveSuppressionConfigRef.current = null
        liveSuppressionSignatureRef.current = null
    }, [])

    return { getAudioContext, playVoiceCue, disconnectAudioContext, buildMicSendTrack, updateMicProcessingSettings, destroyRnnoise }
}
