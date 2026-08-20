import { useCallback, useRef } from 'react'
import { createRnnoiseNode, type RnnoiseNode } from '../rnnoise'
import { getOrCreateAudioContext, playVoiceCueStack, type VoiceCueKind } from '../../audioCues'
import {
    getSliderFromStorage,
    getStoredSpeakingPreset,
} from '../sensitivityThreshold'
import {
    getStoredVoiceInputProfile,
    getStoredVoiceSuppressionTuning,
    shouldUseAggressiveVoiceIsolation,
    type VoiceSuppressionTuning,
} from '../voiceInputProfile'
import { buildMicProcessingConstraints } from '../../voiceDevices'
import {
    linearToDbDiagnostic,
    roundVoiceDiagnosticNumber,
    toVoiceAudioContextDiagnostics,
    toVoiceProcessingConstraintsDiagnostics,
    toVoiceTrackSettingsDiagnostics,
    updateVoiceDiagnostics,
} from '../voiceDiagnostics'

const SOUND_KEY = 'voxpery-settings-sound-enabled'
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'

export function shouldUseLightweightMobileVoicePipeline(
    navigatorTarget: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
    if (!navigatorTarget) return false
    const userAgent = navigatorTarget.userAgent.toLowerCase()
    return /android|iphone|ipad|ipod|mobile/.test(userAgent)
        || (userAgent.includes('macintosh') && navigatorTarget.maxTouchPoints > 1)
}

function dbToLinear(db: number): number {
    return Math.pow(10, db / 20)
}

function pickSuppressionValue<T>(
    tuning: VoiceSuppressionTuning,
    values: { off: T; balanced: T; high: T },
): T {
    return values[tuning]
}

function thresholdDbFromSlider(slider: number): number {
    return Math.max(-100, Math.min(0, Math.round(slider - 100)))
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
    suppressionTuning: VoiceSuppressionTuning,
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

    if (aggressiveIsolation && clickyNoise && !speechLike) {
        return quietish
            ? pickSuppressionValue(suppressionTuning, { off: 0.86, balanced: 0.5, high: 0.3 })
            : pickSuppressionValue(suppressionTuning, { off: 0.92, balanced: 0.68, high: 0.42 })
    }
    if (aggressiveIsolation && boomyNoise && quietish) {
        return pickSuppressionValue(suppressionTuning, { off: 0.86, balanced: 0.52, high: 0.34 })
    }

    if (!speechLike) {
        if (rms <= lowFloorThr || quietish) {
            return aggressiveIsolation
                ? pickSuppressionValue(suppressionTuning, { off: 0.16, balanced: 0.16, high: 0.07 })
                : 0.16
        }
        return clickyNoise || boomyNoise
            ? (aggressiveIsolation
                ? pickSuppressionValue(suppressionTuning, { off: 0.24, balanced: 0.24, high: 0.12 })
                : 0.24)
            : (aggressiveIsolation
                ? pickSuppressionValue(suppressionTuning, { off: 0.3, balanced: 0.34, high: 0.22 })
                : 0.3)
    }

    if (rms <= lowFloorThr) {
        return aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.28, balanced: 0.48, high: 0.3 })
            : 0.28
    }
    if (rms < openFloorThr) {
        const ratio = (rms - lowFloorThr) / Math.max(1e-6, openFloorThr - lowFloorThr)
        const eased = ratio * ratio * (3 - 2 * ratio)
        if (!aggressiveIsolation) return 0.42 + eased * 0.5
        const closedGain = pickSuppressionValue(suppressionTuning, { off: 0.42, balanced: 0.64, high: 0.46 })
        const openGain = pickSuppressionValue(suppressionTuning, { off: 0.92, balanced: 0.98, high: 0.96 })
        return closedGain + eased * (openGain - closedGain)
    }

    if (clickyNoise && quietish) {
        return aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.86, balanced: 0.88, high: 0.8 })
            : 0.86
    }
    return 1
}

function isLikelySpeechFrame(
    frequencyData: Float32Array,
    sampleRate: number,
    fftSize: number,
    aggressiveIsolation: boolean,
    suppressionTuning: VoiceSuppressionTuning,
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
    const noiseDominant =
        highNoiseDb > presenceDb + 2.2
        && highNoiseDb > speechBodyDb + 2.8
        && upperSpeechDb < highNoiseDb + 1.2
    const boomy =
        lowNoiseDb > speechBodyDb + 2.5
        && lowNoiseDb > upperSpeechDb + 3
    const scoreThreshold = aggressiveIsolation
        ? pickSuppressionValue(suppressionTuning, { off: -2.8, balanced: -2, high: -1.8 })
        : -2.8
    return score >= scoreThreshold
        && !clicky
        && !boomy
        && (!aggressiveIsolation || suppressionTuning !== 'high' || !noiseDominant)
}

export interface LiveSuppressionConfig {
    aggressiveIsolation: boolean
    suppressionTuning: VoiceSuppressionTuning
    lowFloorThr: number
    openFloorThr: number
    minFloorGain: number
    floorReleaseAlpha: number
    floorReleaseTime: number
    speechSafeFloorGain: number
    isolationAttenuationAlpha: number
    isolationRecoveryAlpha: number
    isolationAttenuationTime: number
    isolationRecoveryTime: number
}

export interface SuppressionFrameEvaluation {
    targetFloorGain: number
    targetIsolationGain: number
    likelySpeech: boolean
}

interface LiveSuppressionNodes {
    ctx: AudioContext
    highPassFilter: BiquadFilterNode
    lowPassFilter: BiquadFilterNode
    deClickFilter: BiquadFilterNode
    speechPresenceFilter: BiquadFilterNode
    transientCompressor: DynamicsCompressorNode
}

export interface LiveSuppressionFilterConfig {
    highPassHz: number
    lowPassHz: number
    deClickGainDb: number
    speechPresenceGainDb: number
    compressorThresholdDb: number
    compressorKneeDb: number
    compressorRatio: number
    compressorAttackSec: number
    compressorReleaseSec: number
}

export function buildSuppressionFilterConfig(
    aggressiveIsolation: boolean,
    suppressionTuning: VoiceSuppressionTuning,
): LiveSuppressionFilterConfig {
    return {
        highPassHz: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 120, balanced: 110, high: 145 })
            : pickSuppressionValue(suppressionTuning, { off: 120, balanced: 125, high: 145 }),
        lowPassHz: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 7200, balanced: 7600, high: 5600 })
            : pickSuppressionValue(suppressionTuning, { off: 7200, balanced: 6200, high: 4400 }),
        deClickGainDb: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0, balanced: -1.2, high: -5 })
            : pickSuppressionValue(suppressionTuning, { off: 0, balanced: -1.8, high: -4.2 }),
        speechPresenceGainDb: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0, balanced: 0.5, high: 1 })
            : pickSuppressionValue(suppressionTuning, { off: 0, balanced: 1.1, high: 1.75 }),
        compressorThresholdDb: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: -30, balanced: -28, high: -37 })
            : pickSuppressionValue(suppressionTuning, { off: -30, balanced: -31, high: -36 }),
        compressorKneeDb: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 10, balanced: 12, high: 8 })
            : pickSuppressionValue(suppressionTuning, { off: 10, balanced: 10, high: 8 }),
        compressorRatio: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 3.5, balanced: 2.6, high: 4.8 })
            : pickSuppressionValue(suppressionTuning, { off: 3.5, balanced: 3.8, high: 5.4 }),
        compressorAttackSec: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.003, balanced: 0.004, high: 0.002 })
            : pickSuppressionValue(suppressionTuning, { off: 0.003, balanced: 0.0024, high: 0.0015 }),
        compressorReleaseSec: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.085, balanced: 0.12, high: 0.075 })
            : pickSuppressionValue(suppressionTuning, { off: 0.085, balanced: 0.082, high: 0.065 }),
    }
}

export function buildSuppressionConfig(
    noiseSuppressionEnabled: boolean,
): LiveSuppressionConfig {
    const profile = getStoredVoiceInputProfile()
    const speakingPreset = getStoredSpeakingPreset()
    const speakingThreshold = getSliderFromStorage()
    const aggressiveIsolation = shouldUseAggressiveVoiceIsolation(profile, noiseSuppressionEnabled)
    const suppressionTuning = getStoredVoiceSuppressionTuning(noiseSuppressionEnabled)

    updateVoiceDiagnostics({
        benchmarkSchemaVersion: 1,
        noiseSuppressionEnabled,
        voiceInputProfile: profile,
        speakingPreset,
        speakingThreshold,
        speakingThresholdDb: thresholdDbFromSlider(speakingThreshold),
        suppressionTuning,
        aggressiveIsolation,
    })

    return {
        aggressiveIsolation,
        suppressionTuning,
        lowFloorThr: dbToLinear(aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: -51, balanced: -54, high: -43 })
            : pickSuppressionValue(suppressionTuning, { off: -51, balanced: -50, high: -46 })),
        openFloorThr: dbToLinear(aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: -40, balanced: -42, high: -31 })
            : pickSuppressionValue(suppressionTuning, { off: -40, balanced: -38, high: -34 })),
        minFloorGain: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.12, balanced: 0.22, high: 0.035 })
            : pickSuppressionValue(suppressionTuning, { off: 0.12, balanced: 0.1, high: 0.06 }),
        floorReleaseAlpha: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.08, balanced: 0.045, high: 0.08 })
            : pickSuppressionValue(suppressionTuning, { off: 0.08, balanced: 0.075, high: 0.09 }),
        floorReleaseTime: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.06, balanced: 0.11, high: 0.07 })
            : pickSuppressionValue(suppressionTuning, { off: 0.06, balanced: 0.066, high: 0.055 }),
        speechSafeFloorGain: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 1, balanced: 0.9, high: 0.82 })
            : pickSuppressionValue(suppressionTuning, { off: 1, balanced: 0.9, high: 0.84 }),
        isolationAttenuationAlpha: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.14, balanced: 0.1, high: 0.15 })
            : 0.14,
        isolationRecoveryAlpha: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.22, balanced: 0.3, high: 0.28 })
            : 0.22,
        isolationAttenuationTime: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.06, balanced: 0.09, high: 0.075 })
            : 0.06,
        isolationRecoveryTime: aggressiveIsolation
            ? pickSuppressionValue(suppressionTuning, { off: 0.03, balanced: 0.022, high: 0.025 })
            : 0.03,
    }
}

export function evaluateSuppressionFrame(
    frequencyData: Float32Array,
    sampleRate: number,
    fftSize: number,
    rms: number,
    config: LiveSuppressionConfig,
): SuppressionFrameEvaluation {
    let targetFloorGain = 1
    if (rms <= config.lowFloorThr) {
        targetFloorGain = config.minFloorGain
    } else if (rms < config.openFloorThr) {
        const ratio = (rms - config.lowFloorThr) / Math.max(1e-6, config.openFloorThr - config.lowFloorThr)
        const eased = ratio * ratio * (3 - 2 * ratio)
        targetFloorGain = config.minFloorGain + eased * (1 - config.minFloorGain)
    }

    const targetIsolationGain = getSpeechIsolationTarget(
        frequencyData,
        sampleRate,
        fftSize,
        rms,
        config.lowFloorThr,
        config.openFloorThr,
        config.aggressiveIsolation,
        config.suppressionTuning,
    )
    const likelySpeech = isLikelySpeechFrame(
        frequencyData,
        sampleRate,
        fftSize,
        config.aggressiveIsolation,
        config.suppressionTuning,
    )

    if (likelySpeech) {
        targetFloorGain = Math.max(targetFloorGain, config.speechSafeFloorGain)
    }

    return { targetFloorGain, targetIsolationGain, likelySpeech }
}

function applySuppressionConfig(
    nodes: LiveSuppressionNodes,
    config: LiveSuppressionConfig,
) {
    const { ctx, highPassFilter, lowPassFilter, deClickFilter, speechPresenceFilter, transientCompressor } = nodes
    const { aggressiveIsolation, suppressionTuning } = config
    const now = ctx.currentTime
    const filterConfig = buildSuppressionFilterConfig(aggressiveIsolation, suppressionTuning)

    highPassFilter.frequency.setTargetAtTime(filterConfig.highPassHz, now, 0.03)
    lowPassFilter.frequency.setTargetAtTime(filterConfig.lowPassHz, now, 0.03)
    deClickFilter.gain.setTargetAtTime(filterConfig.deClickGainDb, now, 0.03)
    speechPresenceFilter.gain.setTargetAtTime(filterConfig.speechPresenceGainDb, now, 0.04)
    transientCompressor.threshold.setTargetAtTime(filterConfig.compressorThresholdDb, now, 0.03)
    transientCompressor.knee.setTargetAtTime(filterConfig.compressorKneeDb, now, 0.03)
    transientCompressor.ratio.setTargetAtTime(filterConfig.compressorRatio, now, 0.03)
    transientCompressor.attack.setTargetAtTime(filterConfig.compressorAttackSec, now, 0.02)
    transientCompressor.release.setTargetAtTime(filterConfig.compressorReleaseSec, now, 0.03)
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

        playVoiceCueStack(ctx, kind)
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

        updateVoiceDiagnostics({
            benchmarkSchemaVersion: 1,
            captureConstraints: toVoiceProcessingConstraintsDiagnostics(
                buildMicProcessingConstraints(noiseSuppressionEnabled),
            ),
            rawMicTrackSettings: toVoiceTrackSettingsDiagnostics(rawTrack.getSettings?.()),
            audioContext: toVoiceAudioContextDiagnostics(ctx),
            inputVolume: roundVoiceDiagnosticNumber(volumeFactor, 2),
        })

        if (shouldUseLightweightMobileVoicePipeline()) {
            // Mobile browsers already provide hardware-optimized AEC/NS. Avoid the
            // desktop RNNoise + analyser loop here so capture and playback do not
            // compete for the main thread on lower-power devices.
            const source = ctx.createMediaStreamSource(sourceStream)
            const gain = ctx.createGain()
            const destination = ctx.createMediaStreamDestination()
            gain.gain.value = volumeFactor
            source.connect(gain)
            gain.connect(destination)
            const processedTrack = destination.stream.getAudioTracks()[0]
            if (!processedTrack) {
                source.disconnect()
                gain.disconnect()
                return { track: rawTrack, vadStream: sourceStream, cancelGate: () => {} }
            }
            inputGainNodeRef.current = gain
            updateVoiceDiagnostics({
                processedMicTrackSettings: toVoiceTrackSettingsDiagnostics(processedTrack.getSettings?.()),
                mobileOptimizedPipeline: true,
            })
            return {
                track: processedTrack,
                vadStream: sourceStream,
                cancelGate: () => {
                    try { source.disconnect() } catch { /* ignore */ }
                    try { gain.disconnect() } catch { /* ignore */ }
                },
            }
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
        if (noiseSuppressionEnabled) {
            await rnnoise.waitUntilReady()
        }

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

        updateVoiceDiagnostics({
            processedMicTrackSettings: toVoiceTrackSettingsDiagnostics(processedTrack.getSettings?.()),
        })

        inputGainNodeRef.current = volumeGainNode
        const analyserBuffer = new Float32Array(Math.max(128, refinementAnalyser.frequencyBinCount, refinementAnalyser.fftSize))
        const frequencyBuffer = new Float32Array(Math.max(32, refinementAnalyser.frequencyBinCount))
        let rafId: number | null = null
        let currentFloorGain = 1
        let currentIsolationGain = 1
        let lastProcessingDiagnosticsAt = 0

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
                let likelySpeech = false

                if (refinementEnabled) {
                    const evaluation = evaluateSuppressionFrame(
                        frequencyBuffer,
                        ctx.sampleRate,
                        refinementAnalyser.fftSize,
                        rms,
                        liveSuppressionConfig,
                    )
                    targetGain = evaluation.targetFloorGain
                    targetIsolationGain = evaluation.targetIsolationGain
                    likelySpeech = evaluation.likelySpeech
                }

                const alpha = targetGain > currentFloorGain ? 0.38 : liveSuppressionConfig.floorReleaseAlpha
                currentFloorGain = alpha * targetGain + (1 - alpha) * currentFloorGain
                noiseFloorGainNode.gain.setTargetAtTime(
                    currentFloorGain,
                    ctx.currentTime,
                    targetGain > currentFloorGain ? 0.016 : liveSuppressionConfig.floorReleaseTime,
                )
                const recoveringIsolation = targetIsolationGain > currentIsolationGain
                const isolationAlpha = recoveringIsolation
                    ? liveSuppressionConfig.isolationRecoveryAlpha
                    : liveSuppressionConfig.isolationAttenuationAlpha
                currentIsolationGain = isolationAlpha * targetIsolationGain + (1 - isolationAlpha) * currentIsolationGain
                speechIsolationGainNode.gain.setTargetAtTime(
                    currentIsolationGain,
                    ctx.currentTime,
                    recoveringIsolation
                        ? liveSuppressionConfig.isolationRecoveryTime
                        : liveSuppressionConfig.isolationAttenuationTime,
                )
                const nowMs = Date.now()
                if (nowMs - lastProcessingDiagnosticsAt >= 750) {
                    lastProcessingDiagnosticsAt = nowMs
                    updateVoiceDiagnostics({
                        liveProcessing: {
                            rmsDb: linearToDbDiagnostic(rms),
                            floorGain: roundVoiceDiagnosticNumber(currentFloorGain, 3),
                            isolationGain: roundVoiceDiagnosticNumber(currentIsolationGain, 3),
                            likelySpeech,
                        },
                    })
                }
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
