import { useCallback, useEffect, useRef, useState } from 'react'
import {
    offThresholdFromOn,
    SPEAKING_PRESET_KEY,
    SENSITIVITY_THRESHOLD_KEY,
    onThresholdFromSlider,
    type SpeakingPreset,
} from '../webrtc/sensitivityThreshold'
import { buildPreferredMicrophoneConstraints, VOICE_SETTINGS_CHANGED_EVENT } from '../voiceDevices'
import { getStoredVoiceInputProfile, shouldUseAggressiveVoiceIsolation } from '../webrtc/voiceInputProfile'
import { evaluateVoiceGateFrame } from '../webrtc/voiceGate'
import { useAudioEngine } from '../webrtc/hooks/useAudioEngine'

const SETTINGS_CHANGED_EVENT = VOICE_SETTINGS_CHANGED_EVENT
const NS_KEY = 'voxpery-settings-noise-suppression'
const MIC_TEST_MONITOR_GAIN = 0.82

/** Convert RMS (0–~0.5) to a 0–100 display percentage using a log (dB-like) scale. */
function rmsToPercent(rms: number): number {
    if (rms <= 0) return 0
    // Map RMS to dB: 20*log10(rms). Display range -100 dB to 0 dB.
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
    // Binary search for the slider value whose threshold maps closest to barPct.
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

// dB tick marks to show on the bar
const DB_TICKS = [
    { db: -100, label: '-100' },
    { db: -80, label: '-80' },
    { db: -60, label: '-60' },
    { db: -40, label: '-40' },
    { db: -20, label: '-20' },
    { db: 0, label: '0' },
]

interface SensitivityBarProps {
    threshold: number               // 0–100 slider value
    preset: SpeakingPreset
    onThresholdChange: (v: number) => void
    onPresetChange: (preset: SpeakingPreset) => void
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
    const smoothLevelRef = useRef(-100)
    const thresholdRef = useRef(threshold)
    const gateOpenRef = useRef(false)
    const openFramesRef = useRef(0)
    const belowFramesRef = useRef(0)
    const smoothedRmsRef = useRef(0)
    const { buildMicSendTrack, destroyRnnoise, setRnnoiseEnabled } = useAudioEngine()

    useEffect(() => {
        thresholdRef.current = threshold
    }, [threshold])

    // ── Mic monitoring ──
    useEffect(() => {
        if (!monitorEnabled) return
        let cancelled = false
        let settingsHandler: (() => void) | null = null

        const startMic = async () => {
            setMonitorState('requesting')
            setGatePassing(false)
            smoothLevelRef.current = -100
            openFramesRef.current = 0
            belowFramesRef.current = 0
            smoothedRmsRef.current = 0
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    setMicActive(false)
                    setMonitorState('unavailable')
                    return
                }
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: buildPreferredMicrophoneConstraints(),
                    video: false,
                })
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop())
                    return
                }
                streamRef.current = stream

                const nsEnabled = localStorage.getItem(NS_KEY) !== '0'
                const { track: processedTrack, vadStream, cancelGate } = await buildMicSendTrack(
                    stream,
                    1,
                    false,
                    rawMicTrackRef,
                    inputGainNodeRef,
                    nsEnabled,
                )
                if (cancelled) {
                    cancelGate()
                    processedTrack.stop()
                    stream.getTracks().forEach((t) => t.stop())
                    destroyRnnoise()
                    return
                }
                gateCancelRef.current = cancelGate
                processedTrackRef.current = processedTrack

                const AudioCtor =
                    window.AudioContext ||
                    (window as Window & { webkitAudioContext?: typeof AudioContext })
                        .webkitAudioContext
                if (!AudioCtor) {
                    cancelGate()
                    gateCancelRef.current = null
                    processedTrack.stop()
                    processedTrackRef.current = null
                    stream.getTracks().forEach((t) => t.stop())
                    streamRef.current = null
                    destroyRnnoise()
                    setMicActive(false)
                    setMonitorState('unavailable')
                    return
                }

                const ctx = new AudioCtor()
                contextRef.current = ctx
                if (ctx.state === 'suspended') void ctx.resume().catch(() => { })

                const vadSource = ctx.createMediaStreamSource(vadStream)
                const processedSource = ctx.createMediaStreamSource(new MediaStream([processedTrack]))

                const analyser = ctx.createAnalyser()
                analyser.fftSize = 256
                analyser.smoothingTimeConstant = 0
                const monitorGain = ctx.createGain()
                monitorGain.gain.value = 0
                gateOpenRef.current = false
                vadSource.connect(analyser)
                processedSource.connect(monitorGain)
                monitorGain.connect(ctx.destination)

                // Keep analyser branch alive in all browsers.
                const silentSink = ctx.createGain()
                silentSink.gain.value = 0
                analyser.connect(silentSink)
                silentSink.connect(ctx.destination)

                analyserRef.current = analyser
                setMicActive(true)
                setMonitorState('active')

                // Live NS toggle: react to settings changes
                const onSettingsChanged = () => {
                    const nowEnabled = localStorage.getItem(NS_KEY) !== '0'
                    setRnnoiseEnabled(nowEnabled)
                }
                settingsHandler = onSettingsChanged
                window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)

                const bufLen = Math.max(128, analyser.frequencyBinCount, analyser.fftSize)
                const data = new Float32Array(bufLen)
                const frequencyData = new Float32Array(Math.max(32, analyser.frequencyBinCount))
                const attackAlpha = 0.42
                const releaseAlpha = 0.14

                const tick = () => {
                    if (cancelled) return
                    try {
                        if (ctx.state !== 'closed' && ctx.state !== 'suspended') {
                            analyser.getFloatTimeDomainData(data)
                            let sum = 0
                            for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
                            const rmsRaw = Math.sqrt(sum / data.length)
                            const rms = Number.isFinite(rmsRaw) ? rmsRaw : 0
                            const dbRaw = 20 * Math.log10(Math.max(rms, 1e-6))
                            const db = Math.max(-100, Math.min(0, Math.round(Number.isFinite(dbRaw) ? dbRaw : -100)))
                            analyser.getFloatFrequencyData(frequencyData)
                            const onThr = onThresholdFromSlider(thresholdRef.current)
                            const offThr = offThresholdFromOn(onThr)
                            const nsEnabled = localStorage.getItem(NS_KEY) !== '0'
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
                            if (decision.speaking !== gateOpenRef.current) {
                                gateOpenRef.current = decision.speaking
                                setGatePassing(decision.speaking)
                                monitorGain.gain.setTargetAtTime(
                                    decision.speaking ? MIC_TEST_MONITOR_GAIN : 0,
                                    ctx.currentTime,
                                    decision.speaking ? 0.02 : 0.03,
                                )
                            }
                            const previousDb = smoothLevelRef.current
                            const smoothingAlpha = db > previousDb ? attackAlpha : releaseAlpha
                            smoothLevelRef.current =
                                smoothingAlpha * db + (1 - smoothingAlpha) * previousDb
                            const smoothedDb = Math.max(-100, Math.min(0, Math.round(Number.isFinite(smoothLevelRef.current) ? smoothLevelRef.current : -100)))
                            setLiveDb(smoothedDb)
                        }
                    } catch {
                        // ignore
                    }
                    rafRef.current = requestAnimationFrame(tick)
                }
                rafRef.current = requestAnimationFrame(tick)
            } catch {
                // mic permission denied or unavailable
                gateCancelRef.current?.()
                gateCancelRef.current = null
                try {
                    processedTrackRef.current?.stop()
                } catch {
                    // ignore
                }
                processedTrackRef.current = null
                streamRef.current?.getTracks().forEach((t) => t.stop())
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
            if (settingsHandler) window.removeEventListener(SETTINGS_CHANGED_EVENT, settingsHandler)
            gateCancelRef.current?.()
            gateCancelRef.current = null
            streamRef.current?.getTracks().forEach((t) => t.stop())
            streamRef.current = null
            try {
                processedTrackRef.current?.stop()
            } catch {
                // ignore
            }
            processedTrackRef.current = null
            rawMicTrackRef.current = null
            inputGainNodeRef.current = null
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
    }, [buildMicSendTrack, destroyRnnoise, monitorEnabled, setRnnoiseEnabled])

    // ── Threshold bar position + dB display ──
    const thresholdDb = Math.round(Math.min(0, Math.max(-100, threshold - 100)))
    const thresholdPosRaw = thresholdToBarPosition(threshold)
    const thresholdPos = Math.min(100, Math.max(0, thresholdPosRaw))

    // ── Drag / click handling ──
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
        [onPresetChange, onThresholdChange]
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
        [applyPosition]
    )

    const liveLevelPos = dbToPercent(liveDb)

    // Determine color of level fill: green (low), yellow (mid), red (high)
    const levelColor =
        liveLevelPos < 40
            ? 'var(--sensitivity-green, #43b581)'
            : liveLevelPos < 70
                ? 'var(--sensitivity-yellow, #faa61a)'
                : 'var(--sensitivity-red, #f04747)'

    // Is the live level above the threshold?
    const permissionNote =
        monitorEnabled && micActive
            ? 'Mic test is active. You hear yourself only when your voice passes the threshold.'
            : monitorState === 'requesting'
                ? 'Requesting microphone access…'
                : monitorState === 'denied'
                    ? 'Microphone access denied. Allow it and retry.'
                    : monitorState === 'unavailable'
                        ? 'Microphone API is not available in this environment.'
                        : 'Microphone access is only requested when you start testing.'

    return (
        <div className="sensitivity-bar-wrap">
            <div className="sensitivity-bar-top">
                <div className="sensitivity-bar-copy">
                    <div className="sensitivity-bar-title">Input sensitivity</div>
                    <div className="sensitivity-bar-subtitle">Use a quick preset or fine-tune the threshold below.</div>
                </div>
                <div className="sensitivity-bar-controls">
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
                            : monitorState === 'requesting'
                                ? 'Requesting…'
                                : monitorState === 'denied'
                                    ? 'Retry mic access'
                                    : 'Start mic test'}
                    </button>
                    <select
                        className="user-select sensitivity-bar-select"
                        value={preset}
                        onChange={(e) => onPresetChange(e.target.value as SpeakingPreset)}
                    >
                        <option value="quiet">Quiet room</option>
                        <option value="normal">Balanced</option>
                        <option value="noisy">Noisy room</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
            </div>
            <div className="sensitivity-bar-permission-note" title={permissionNote}>{permissionNote}</div>
            <div className="sensitivity-bar-header">
                <span className="sensitivity-bar-title">Input sensitivity ({thresholdDb}dB)</span>
                <span className="sensitivity-bar-value">
                    {micActive ? (
                        <span className={`sensitivity-bar-indicator ${gatePassing ? 'is-active' : 'is-listening'}`}>
                            {gatePassing ? 'Passing threshold' : 'Below threshold'}
                        </span>
                    ) : (
                        <span className="sensitivity-bar-indicator is-no-mic">No mic</span>
                    )}
                </span>
            </div>

            {/* The bar */}
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
                {/* Live mic level fill */}
                <div
                    className="sensitivity-bar-level"
                    style={{
                        width: `${liveLevelPos}%`,
                        background: levelColor,
                        opacity: micActive ? 1 : 0.3,
                    }}
                />

                {/* Live input marker so the current speaking point is always visible */}
                <div
                    className={`sensitivity-bar-live-marker ${micActive ? '' : 'is-hidden'}`}
                    style={{ left: `${liveLevelPos}%` }}
                    aria-hidden
                />

                {/* Dimmed zone (below threshold) */}
                <div
                    className="sensitivity-bar-gate"
                    style={{ width: `${thresholdPos}%` }}
                />

                {/* Threshold marker */}
                <div
                    className="sensitivity-bar-threshold"
                    style={{ left: `${thresholdPos}%` }}
                >
                    <div className="sensitivity-bar-threshold-handle" />
                </div>
            </div>

            {/* dB ticks */}
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
