import { useCallback, useEffect, useRef, useState } from 'react'
import {
    SENSITIVITY_THRESHOLD_KEY,
    onThresholdFromSlider,
} from '../webrtc/sensitivityThreshold'
import { createRnnoiseNode, type RnnoiseNode } from '../webrtc/rnnoise'

const SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'
const SPEAKING_PRESET_KEY = 'voxpery-settings-speaking-preset'
const NS_KEY = 'voxpery-settings-noise-suppression'

/** Convert RMS (0–~0.5) to a 0–100 display percentage using a log (dB-like) scale. */
function rmsToPercent(rms: number): number {
    if (rms <= 0) return 0
    // Map RMS to dB: 20*log10(rms). Range roughly -60 dB to 0 dB.
    const db = 20 * Math.log10(Math.max(rms, 1e-6))
    const minDb = -60
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
    { db: -60, label: '-60' },
    { db: -40, label: '-40' },
    { db: -20, label: '-20' },
    { db: 0, label: '0' },
]

interface SensitivityBarProps {
    threshold: number               // 0–100 slider value
    onThresholdChange: (v: number) => void
    onPresetChange: (preset: 'custom') => void
}

export default function SensitivityBar({
    threshold,
    onThresholdChange,
    onPresetChange,
}: SensitivityBarProps) {
    const [micLevel, setMicLevel] = useState(0)         // 0–100 display %
    const [micActive, setMicActive] = useState(false)
    const barRef = useRef<HTMLDivElement>(null)
    const draggingRef = useRef(false)
    const rafRef = useRef<number | null>(null)
    const contextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const smoothLevelRef = useRef(0)

    // ── Mic monitoring ──
    useEffect(() => {
        let cancelled = false
        let rnnoiseNode: RnnoiseNode | null = null
        let settingsHandler: (() => void) | null = null

        const startMic = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false,
                })
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop())
                    return
                }
                streamRef.current = stream

                const AudioCtor =
                    window.AudioContext ||
                    (window as Window & { webkitAudioContext?: typeof AudioContext })
                        .webkitAudioContext
                if (!AudioCtor) return

                const ctx = new AudioCtor()
                contextRef.current = ctx
                if (ctx.state === 'suspended') void ctx.resume().catch(() => { })

                const source = ctx.createMediaStreamSource(stream)

                // Route through RNNoise when noise suppression is enabled,
                // so the bar shows the same levels the speaking indicator sees.
                const nsEnabled = localStorage.getItem(NS_KEY) !== '0'
                rnnoiseNode = createRnnoiseNode(ctx, nsEnabled)

                const analyser = ctx.createAnalyser()
                analyser.fftSize = 256
                analyser.smoothingTimeConstant = 0
                source.connect(rnnoiseNode.node)
                rnnoiseNode.node.connect(analyser)

                // ScriptProcessorNode requires the graph to reach ctx.destination
                // to fire onaudioprocess. Connect via a silent sink (gain=0).
                const silentSink = ctx.createGain()
                silentSink.gain.value = 0
                analyser.connect(silentSink)
                silentSink.connect(ctx.destination)

                analyserRef.current = analyser
                setMicActive(true)

                // Live NS toggle: react to settings changes
                const onSettingsChanged = () => {
                    const nowEnabled = localStorage.getItem(NS_KEY) !== '0'
                    rnnoiseNode?.setEnabled(nowEnabled)
                }
                settingsHandler = onSettingsChanged
                window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)

                const bufLen = Math.max(128, analyser.frequencyBinCount, analyser.fftSize)
                const data = new Float32Array(bufLen)
                const alpha = 0.35 // smoothing for display

                const tick = () => {
                    if (cancelled) return
                    try {
                        if (ctx.state !== 'closed' && ctx.state !== 'suspended') {
                            analyser.getFloatTimeDomainData(data)
                            let sum = 0
                            for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
                            const rms = Math.sqrt(sum / data.length)
                            const pct = rmsToPercent(rms)
                            smoothLevelRef.current =
                                alpha * pct + (1 - alpha) * smoothLevelRef.current
                            setMicLevel(smoothLevelRef.current)
                        }
                    } catch {
                        // ignore
                    }
                    rafRef.current = requestAnimationFrame(tick)
                }
                rafRef.current = requestAnimationFrame(tick)
            } catch {
                // mic permission denied or unavailable
                setMicActive(false)
            }
        }

        void startMic()

        return () => {
            cancelled = true
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
            if (settingsHandler) window.removeEventListener(SETTINGS_CHANGED_EVENT, settingsHandler)
            rnnoiseNode?.destroy()
            streamRef.current?.getTracks().forEach((t) => t.stop())
            streamRef.current = null
            try {
                contextRef.current?.close()
            } catch {
                // ignore
            }
            contextRef.current = null
            analyserRef.current = null
        }
    }, [])

    // ── Threshold bar position + dB display ──
    const thresholdPos = thresholdToBarPosition(threshold)
    const thresholdRms = onThresholdFromSlider(threshold)
    const thresholdDb = thresholdRms > 0 ? Math.round(20 * Math.log10(thresholdRms)) : -60

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

    // Determine color of level fill: green (low), yellow (mid), red (high)
    const levelColor =
        micLevel < 40
            ? 'var(--sensitivity-green, #43b581)'
            : micLevel < 70
                ? 'var(--sensitivity-yellow, #faa61a)'
                : 'var(--sensitivity-red, #f04747)'

    // Is the live level above the threshold?
    const aboveThreshold = micLevel >= thresholdPos

    return (
        <div className="sensitivity-bar-wrap">
            <div className="sensitivity-bar-header">
                <span className="sensitivity-bar-title">Input sensitivity ({thresholdDb}dB)</span>
                <span className="sensitivity-bar-value">
                    {micActive ? (
                        <span className={`sensitivity-bar-indicator ${aboveThreshold ? 'is-active' : ''}`}>
                            {aboveThreshold ? '● Voice detected' : '○ Below threshold'}
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
                        width: `${micLevel}%`,
                        background: levelColor,
                        opacity: micActive ? 1 : 0.3,
                    }}
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
                    const pos = ((tick.db - -60) / (0 - -60)) * 100
                    return (
                        <span
                            key={tick.db}
                            className="sensitivity-bar-tick"
                            style={{ left: `${pos}%` }}
                        >
                            {tick.label}dB
                        </span>
                    )
                })}
            </div>
        </div>
    )
}
