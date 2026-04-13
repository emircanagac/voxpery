import { useCallback, useEffect, useRef, useState } from 'react'
import {
    SPEAKING_PRESET_KEY,
    SENSITIVITY_THRESHOLD_KEY,
    offThresholdFromOn,
    onThresholdFromSlider,
    type SpeakingPreset,
} from '../webrtc/sensitivityThreshold'
import {
    VOICE_SETTINGS_CHANGED_EVENT,
    applyPreferredAudioOutputDevice,
    buildPreferredMicrophoneConstraints,
} from '../voiceDevices'
import { evaluateVoiceGateFrame } from '../webrtc/voiceGate'
import {
    getStoredVoiceInputProfile,
    getVoiceSuppressionTuningForThreshold,
    shouldUseAggressiveVoiceIsolation,
} from '../webrtc/voiceInputProfile'
import { useAudioEngine } from '../webrtc/hooks/useAudioEngine'

const SETTINGS_CHANGED_EVENT = VOICE_SETTINGS_CHANGED_EVENT
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'
const INPUT_VOL_KEY = 'voxpery-settings-input-volume'
const DEFAULT_INPUT_VOLUME = 80
const MIC_TEST_MONITOR_GAIN = 0.82
const MIC_TEST_AUTO_DEAFEN_EVENT = 'voxpery-mic-test-auto-deafen'
const MIC_TEST_GLOW_SUPPRESS_MS = 220
const MIC_TEST_GATE_DISPLAY_MARGIN_DB = 1
const MIC_TEST_PRESET_SWITCH_MUTE_MS = 180

function buildMicTestConstraints(): MediaTrackConstraints {
    return {
        ...buildPreferredMicrophoneConstraints(),
        channelCount: 1,
        echoCancellation: false,
        autoGainControl: false,
    }
}

function getInputVolumeFactor(): number {
    const raw = Math.min(100, Math.max(1, Number(localStorage.getItem(INPUT_VOL_KEY)) || DEFAULT_INPUT_VOLUME))
    return raw / 100
}

/** Convert RMS (0–~0.5) to a 0–100 display percentage using a log (dB-like) scale. */
function rmsToPercent(rms: number): number {
    if (rms <= 0) return 0
    const db = 20 * Math.log10(Math.max(rms, 1e-6))
    const minDb = -100
    const maxDb = 0
    const pct = ((db - minDb) / (maxDb - minDb)) * 100
    return Math.min(100, Math.max(0, pct))
}

/** Convert our threshold slider (0–100) to a bar position (0–100%) on the dB scale. */
function thresholdToBarPosition(slider: number): number {
    const rms = onThresholdFromSlider(slider)
    return rmsToPercent(rms)
}

/** Inverse: convert a bar position (0–100% on dB scale) back to slider value (0–100). */
function barPositionToSlider(barPct: number): number {
    let lo = 0
    let hi = 100
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2
        const pos = thresholdToBarPosition(mid)
        if (pos < barPct) lo = mid
        else hi = mid
    }
    return Math.round((lo + hi) / 2)
}

const DB_TICKS = [
    { db: -100, label: '-100' },
    { db: -80, label: '-80' },
    { db: -60, label: '-60' },
    { db: -40, label: '-40' },
    { db: -20, label: '-20' },
    { db: 0, label: '0' },
]

interface SensitivityBarProps {
    threshold: number
    preset: SpeakingPreset
    onThresholdChange: (v: number) => void
    onPresetChange: (preset: SpeakingPreset) => void
    previewAvatarUrl?: string | null
    previewFallback: string
}

function dbToPercent(db: number): number {
    if (!Number.isFinite(db)) return 0
    const pct = ((db + 100) / 100) * 100
    return Math.min(100, Math.max(0, pct))
}

export default function SensitivityBar({
    threshold,
    preset,
    onThresholdChange,
    onPresetChange,
    previewAvatarUrl,
    previewFallback,
}: SensitivityBarProps) {
    const [liveDb, setLiveDb] = useState(-100)
    const [micActive, setMicActive] = useState(false)
    const [monitorEnabled, setMonitorEnabled] = useState(false)
    const [monitorState, setMonitorState] = useState<'idle' | 'requesting' | 'active' | 'denied' | 'unavailable'>('idle')
    const [gatePassing, setGatePassing] = useState(false)

    const barRef = useRef<HTMLDivElement>(null)
    const draggingRef = useRef(false)
    const rafRef = useRef<number | null>(null)
    const contextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const processedTrackRef = useRef<MediaStreamTrack | null>(null)
    const gateCancelRef = useRef<(() => void) | null>(null)
    const rawMicTrackRef = useRef<MediaStreamTrack | null>(null)
    const inputGainNodeRef = useRef<GainNode | null>(null)
    const monitorAudioRef = useRef<(HTMLAudioElement & { playsInline?: boolean }) | null>(null)
    const smoothLevelRef = useRef(-100)
    const thresholdRef = useRef(threshold)
    const gateOpenRef = useRef(false)
    const openFramesRef = useRef(0)
    const belowFramesRef = useRef(0)
    const smoothedRmsRef = useRef(0)
    const glowSuppressUntilRef = useRef(0)
    const interactionMuteUntilRef = useRef(0)
    const previousPresetRef = useRef<SpeakingPreset>(preset)
    const { buildMicSendTrack, destroyRnnoise, setRnnoiseEnabled } = useAudioEngine()
    const noiseSuppressionEnabled = typeof localStorage === 'undefined'
        ? true
        : localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
    const suppressionTuningKey = getVoiceSuppressionTuningForThreshold(threshold, noiseSuppressionEnabled)

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.dispatchEvent(new CustomEvent(MIC_TEST_AUTO_DEAFEN_EVENT, { detail: { enabled: monitorEnabled } }))
    }, [monitorEnabled])

    useEffect(() => {
        thresholdRef.current = threshold
    }, [threshold])

    useEffect(() => {
        if (previousPresetRef.current === preset) return
        previousPresetRef.current = preset
        if (!monitorEnabled) return
        const nowTs = typeof performance !== 'undefined' ? performance.now() : Date.now()
        interactionMuteUntilRef.current = nowTs + MIC_TEST_PRESET_SWITCH_MUTE_MS
    }, [monitorEnabled, preset])

    useEffect(() => {
        if (!monitorEnabled) return

        let cancelled = false
        let detachSettingsListener: (() => void) | null = null

        const startMic = async () => {
            setMonitorState('requesting')
            setGatePassing(false)
            setMicActive(false)
            smoothLevelRef.current = -100
            openFramesRef.current = 0
            belowFramesRef.current = 0
            smoothedRmsRef.current = 0

            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    setMonitorState('unavailable')
                    return
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: buildMicTestConstraints(),
                    video: false,
                })
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }
                streamRef.current = stream

                const noiseSuppressionEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
                const { track: processedTrack, vadStream, cancelGate } = await buildMicSendTrack(
                    stream,
                    getInputVolumeFactor(),
                    false,
                    rawMicTrackRef,
                    inputGainNodeRef,
                    noiseSuppressionEnabled,
                )
                if (cancelled) {
                    cancelGate()
                    processedTrack.stop()
                    stream.getTracks().forEach((track) => track.stop())
                    destroyRnnoise()
                    return
                }
                processedTrackRef.current = processedTrack
                gateCancelRef.current = cancelGate

                const AudioCtor =
                    window.AudioContext
                    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
                if (!AudioCtor) {
                    cancelGate()
                    gateCancelRef.current = null
                    processedTrack.stop()
                    processedTrackRef.current = null
                    stream.getTracks().forEach((track) => track.stop())
                    streamRef.current = null
                    destroyRnnoise()
                    setMonitorState('unavailable')
                    return
                }

                const ctx = new AudioCtor()
                contextRef.current = ctx
                if (ctx.state === 'suspended') void ctx.resume().catch(() => { })

                const analyser = ctx.createAnalyser()
                analyser.fftSize = 256
                analyser.smoothingTimeConstant = 0
                const vadSource = ctx.createMediaStreamSource(vadStream)
                vadSource.connect(analyser)

                const silentSink = ctx.createGain()
                silentSink.gain.value = 0
                analyser.connect(silentSink)
                silentSink.connect(ctx.destination)
                analyserRef.current = analyser

                const monitorAudio = new Audio() as HTMLAudioElement & { playsInline?: boolean }
                monitorAudio.autoplay = true
                monitorAudio.playsInline = true
                monitorAudio.muted = false
                monitorAudio.volume = MIC_TEST_MONITOR_GAIN
                monitorAudio.srcObject = vadStream
                monitorAudioRef.current = monitorAudio
                void applyPreferredAudioOutputDevice(monitorAudio)
                void monitorAudio.play().catch(() => { })

                const onSettingsChanged = () => {
                    const nowEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
                    setRnnoiseEnabled(nowEnabled)
                    if (monitorAudioRef.current) {
                        void applyPreferredAudioOutputDevice(monitorAudioRef.current)
                    }
                }
                window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
                detachSettingsListener = () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)

                gateOpenRef.current = false
                glowSuppressUntilRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + MIC_TEST_GLOW_SUPPRESS_MS
                setGatePassing(false)
                setMicActive(true)
                setMonitorState('active')

                const timeData = new Float32Array(Math.max(128, analyser.frequencyBinCount, analyser.fftSize))
                const frequencyData = new Float32Array(Math.max(32, analyser.frequencyBinCount))
                const attackAlpha = 0.42
                const releaseAlpha = 0.14

                const tick = () => {
                    if (cancelled) return
                    try {
                        if (ctx.state !== 'closed' && ctx.state !== 'suspended') {
                            analyser.getFloatTimeDomainData(timeData)
                            analyser.getFloatFrequencyData(frequencyData)

                            let sum = 0
                            for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i]
                            const rmsRaw = Math.sqrt(sum / timeData.length)
                            const rms = Number.isFinite(rmsRaw) ? rmsRaw : 0
                            const dbRaw = 20 * Math.log10(Math.max(rms, 1e-6))
                            const db = Math.max(-100, Math.min(0, Math.round(Number.isFinite(dbRaw) ? dbRaw : -100)))

                            const onThr = onThresholdFromSlider(thresholdRef.current)
                            const offThr = offThresholdFromOn(onThr)
                            const nsEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
                            const profile = getStoredVoiceInputProfile()
                            const aggressiveIsolation = shouldUseAggressiveVoiceIsolation(profile, nsEnabled)
                            const decision = evaluateVoiceGateFrame({
                                rms,
                                frequencyData,
                                sampleRate: ctx.sampleRate,
                                fftSize: analyser.fftSize,
                                onThr,
                                offThr,
                                noiseSuppressionEnabled: nsEnabled,
                                aggressiveIsolation,
                                speaking: gateOpenRef.current,
                                openFrames: openFramesRef.current,
                                belowFrames: belowFramesRef.current,
                                smoothedRms: smoothedRmsRef.current,
                            })

                            openFramesRef.current = decision.openFrames
                            belowFramesRef.current = decision.belowFrames
                            smoothedRmsRef.current = decision.smoothedRms

                            const nowTs = typeof performance !== 'undefined' ? performance.now() : Date.now()
                            const suppressGlow = nowTs < glowSuppressUntilRef.current
                            const suppressInteractionPreview = nowTs < interactionMuteUntilRef.current
                            if (decision.speaking !== gateOpenRef.current) {
                                gateOpenRef.current = decision.speaking
                            }
                            const previousDb = smoothLevelRef.current
                            const levelBlend = db > previousDb ? attackAlpha : releaseAlpha
                            smoothLevelRef.current = levelBlend * db + (1 - levelBlend) * previousDb
                            const smoothedDb = Math.max(
                                -100,
                                Math.min(0, Math.round(Number.isFinite(smoothLevelRef.current) ? smoothLevelRef.current : -100)),
                            )
                            const thresholdDbNow = Math.round(Math.min(0, Math.max(-100, thresholdRef.current - 100)))
                            const previewShouldPass = decision.speaking && smoothedDb >= thresholdDbNow
                            const shouldGlow = !suppressGlow && previewShouldPass
                            setGatePassing((prev) => (prev === shouldGlow ? prev : shouldGlow))
                            const displayedDb = previewShouldPass
                                ? Math.max(smoothedDb, Math.min(0, thresholdDbNow + MIC_TEST_GATE_DISPLAY_MARGIN_DB))
                                : smoothedDb
                            setLiveDb(displayedDb)
                            if (monitorAudioRef.current) {
                                monitorAudioRef.current.volume = suppressInteractionPreview ? 0 : MIC_TEST_MONITOR_GAIN
                            }
                        }
                    } catch {
                        // ignore
                    }
                    rafRef.current = requestAnimationFrame(tick)
                }

                rafRef.current = requestAnimationFrame(tick)
            } catch {
                gateCancelRef.current?.()
                gateCancelRef.current = null
                try {
                    processedTrackRef.current?.stop()
                } catch {
                    // ignore
                }
                processedTrackRef.current = null
                streamRef.current?.getTracks().forEach((track) => track.stop())
                streamRef.current = null
                destroyRnnoise()
                setMicActive(false)
                setGatePassing(false)
                setMonitorState('denied')
            }
        }

        void startMic()

        return () => {
            cancelled = true
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
            detachSettingsListener?.()
            gateCancelRef.current?.()
            gateCancelRef.current = null
            try {
                processedTrackRef.current?.stop()
            } catch {
                // ignore
            }
            processedTrackRef.current = null
            rawMicTrackRef.current = null
            inputGainNodeRef.current = null
            try {
                monitorAudioRef.current?.pause()
                if (monitorAudioRef.current) monitorAudioRef.current.srcObject = null
            } catch {
                // ignore
            }
            monitorAudioRef.current = null
            streamRef.current?.getTracks().forEach((track) => track.stop())
            streamRef.current = null
            destroyRnnoise()
            setMicActive(false)
            setGatePassing(false)
            smoothLevelRef.current = -100
            setLiveDb(-100)
            try {
                analyserRef.current?.disconnect()
            } catch {
                // ignore
            }
            try {
                contextRef.current?.close()
            } catch {
                // ignore
            }
            contextRef.current = null
            analyserRef.current = null
        }
    }, [buildMicSendTrack, destroyRnnoise, monitorEnabled, setRnnoiseEnabled, suppressionTuningKey])

    useEffect(() => {
        return () => {
            if (typeof window === 'undefined') return
            window.dispatchEvent(new CustomEvent(MIC_TEST_AUTO_DEAFEN_EVENT, { detail: { enabled: false } }))
        }
    }, [])

    const thresholdDb = Math.round(Math.min(0, Math.max(-100, threshold - 100)))
    const thresholdPosRaw = thresholdToBarPosition(threshold)
    const thresholdPos = Math.min(100, Math.max(0, thresholdPosRaw))

    const applyPosition = useCallback(
        (clientX: number) => {
            const bar = barRef.current
            if (!bar) return
            const rect = bar.getBoundingClientRect()
            const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
            const slider = barPositionToSlider(pct)
            onThresholdChange(slider)
            localStorage.setItem(SENSITIVITY_THRESHOLD_KEY, String(slider))
            onPresetChange('custom')
            localStorage.setItem(SPEAKING_PRESET_KEY, 'custom')
        },
        [onPresetChange, onThresholdChange],
    )

    const onMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault()
            draggingRef.current = true
            applyPosition(e.clientX)

            const onMove = (ev: MouseEvent) => {
                if (draggingRef.current) applyPosition(ev.clientX)
            }
            const onUp = () => {
                draggingRef.current = false
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
                window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT))
            }

            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
        },
        [applyPosition],
    )

    const liveLevelPos = dbToPercent(liveDb)
    const levelColor =
        liveLevelPos < 40
            ? 'var(--sensitivity-green, #43b581)'
            : liveLevelPos < 70
                ? 'var(--sensitivity-yellow, #faa61a)'
                : 'var(--sensitivity-red, #f04747)'

    return (
        <div className="sensitivity-bar-wrap">
            <div className="sensitivity-bar-top">
                <div className="sensitivity-bar-copy">
                    <div className="sensitivity-bar-title-row">
                        <div className="sensitivity-bar-title">Input sensitivity</div>
                        <span className="sensitivity-bar-db-chip">{thresholdDb}dB</span>
                    </div>
                    <div className="sensitivity-bar-subtitle">Keep the threshold just below your normal speech.</div>
                </div>
                <div className="sensitivity-bar-controls">
                    <div className="sensitivity-bar-test-group">
                        <div className="sensitivity-bar-preview-shell sensitivity-bar-preview-shell--control">
                            <div className={`sensitivity-bar-preview-avatar${gatePassing ? ' is-speaking' : ''}`}>
                                {previewAvatarUrl ? (
                                    <img src={previewAvatarUrl} alt="Mic test preview" className="user-avatar-image" />
                                ) : (
                                    previewFallback
                                )}
                            </div>
                            <button
                                type="button"
                                className="user-toggle sensitivity-bar-test-btn"
                                onClick={() => {
                                    if (monitorEnabled) {
                                        setMonitorEnabled(false)
                                        setMonitorState('idle')
                                        setMicActive(false)
            setGatePassing(false)
            smoothLevelRef.current = -100
            setLiveDb(-100)
                                        return
                                    }
                                    setMonitorEnabled(true)
                                }}
                                disabled={monitorState === 'requesting' || monitorState === 'unavailable'}
                            >
                                {monitorEnabled
                                    ? 'Stop mic test'
                                    : monitorState === 'denied'
                                        ? 'Retry mic access'
                                        : 'Start mic test'}
                            </button>
                        </div>
                    </div>
                    <select
                        className="user-select sensitivity-bar-select"
                        value={preset}
                        onChange={(e) => onPresetChange(e.target.value as SpeakingPreset)}
                    >
                        <option value="normal">Balanced</option>
                        <option value="noisy">Noisy room</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
            </div>

            <div
                ref={barRef}
                className="sensitivity-bar-track"
                onMouseDown={onMouseDown}
                role="slider"
                aria-valuenow={threshold}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Sensitivity threshold"
                tabIndex={0}
            >
                <div
                    className="sensitivity-bar-level"
                    style={{
                        width: `${liveLevelPos}%`,
                        background: levelColor,
                        opacity: micActive ? 1 : 0.3,
                    }}
                />

                <div
                    className={`sensitivity-bar-live-marker ${micActive ? '' : 'is-hidden'}`}
                    style={{ left: `${liveLevelPos}%` }}
                    aria-hidden
                />

                <div
                    className="sensitivity-bar-gate"
                    style={{ width: `${thresholdPos}%` }}
                />

                <div
                    className="sensitivity-bar-threshold"
                    style={{ left: `${thresholdPos}%` }}
                >
                    <div
                        className={`sensitivity-bar-threshold-handle${threshold <= 0 ? ' is-edge-start' : threshold >= 100 ? ' is-edge-end' : ''}`}
                    />
                </div>
            </div>

            <div className="sensitivity-bar-ticks">
                {DB_TICKS.map((tick) => {
                    const pos = ((tick.db - -100) / (0 - -100)) * 100
                    return (
                        <span
                            key={tick.db}
                            className="sensitivity-bar-tick"
                            style={{
                                left: `${pos}%`,
                                transform: tick.db === -100
                                    ? 'translateX(0)'
                                    : tick.db === 0
                                        ? 'translateX(-100%)'
                                        : 'translateX(-50%)',
                            }}
                        >
                            {tick.label}dB
                        </span>
                    )
                })}
            </div>
        </div>
    )
}
