import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../stores/app'
import { getThresholdsFromStorage } from '../sensitivityThreshold'
import {
    getStoredVoiceInputProfile,
    getStoredVoiceMode,
    shouldUseAggressiveVoiceIsolation,
} from '../voiceInputProfile'
import { evaluateVoiceGateFrame } from '../voiceGate'
import { linearToDbDiagnostic, updateVoiceDiagnostics } from '../voiceDiagnostics'

const PTT_KEY_KEY = 'voxpery-settings-ptt-key'
const SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'

export type VoiceMode = 'voice_activity' | 'push_to_talk'

export function useVoiceActivity(options: {
    userId: string | null
    joinedChannelId: string | null
    localStream: MediaStream | null
    getAudioContext: () => AudioContext | null
    setLocalMicMuted: (muted: boolean) => Promise<void>
}) {
    const { userId, joinedChannelId, localStream, getAudioContext, setLocalMicMuted } = options
    const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => getStoredVoiceMode())

    const pttPressedRef = useRef(false)
    const voiceActivitySpeakingRef = useRef(false)
    const inlineMonitorIntervalRef = useRef<number | null>(null)
    const monitorSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
    const monitorAnalyserRef = useRef<AnalyserNode | null>(null)

    const getVoiceModeSettings = useCallback((): { mode: VoiceMode; key: string } => {
        const mode = getStoredVoiceMode()
        const keyRaw = localStorage.getItem(PTT_KEY_KEY)
        const key = keyRaw && keyRaw.trim().length > 0 ? keyRaw.trim() : 'V'
        return { mode, key }
    }, [])

    const applyPushToTalkGate = useCallback(() => {
        if (!userId) return
        const { mode } = getVoiceModeSettings()
        const control = useAppStore.getState().voiceControls[userId]
        const manualMuted = !!control?.muted
        const deafened = !!control?.deafened
        const shouldEnable = mode === 'push_to_talk'
            ? (pttPressedRef.current && !manualMuted && !deafened)
            : (!manualMuted && !deafened)
        void setLocalMicMuted(!shouldEnable)
    }, [getVoiceModeSettings, setLocalMicMuted, userId])

    const gateOpenRef = useRef(true)

    const cleanupMonitorNodes = useCallback(() => {
        try {
            monitorSourceRef.current?.disconnect()
        } catch {
            // ignore
        }
        try {
            monitorAnalyserRef.current?.disconnect()
        } catch {
            // ignore
        }
        monitorSourceRef.current = null
        monitorAnalyserRef.current = null
    }, [])

    const resetVoiceActivityGate = useCallback(() => {
        gateOpenRef.current = true
        voiceActivitySpeakingRef.current = false
    }, [])

    const applyVoiceActivityGate = useCallback((speaking: boolean, options?: { updateSpeakingRef?: boolean }) => {
        if (options?.updateSpeakingRef !== false) {
            voiceActivitySpeakingRef.current = speaking
        }
        // Keep the published microphone sender stable. LiveKit's Opus DTX and
        // the existing suppression pipeline already handle quiet periods;
        // swapping sender tracks at every VAD edge can interrupt multi-party
        // audio sessions and remote media playback on some platforms.
        gateOpenRef.current = true
    }, [])

    const startLocalSpeakingMonitor = useCallback((streamOverride?: MediaStream | null) => {
        const stream = streamOverride ?? localStream
        if (!stream) return
        const ctx = getAudioContext()
        if (!ctx) return

        if (inlineMonitorIntervalRef.current != null) {
            cancelAnimationFrame(inlineMonitorIntervalRef.current)
            inlineMonitorIntervalRef.current = null
        }
        cleanupMonitorNodes()
        resetVoiceActivityGate()

        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        monitorSourceRef.current = source
        monitorAnalyserRef.current = analyser
        analyser.fftSize = 256
        // Keep attack snappy so the ring lights up as soon as speech starts,
        // while release smoothness is handled below with hold + RMS smoothing.
        analyser.smoothingTimeConstant = 0.16
        source.connect(analyser)

        const monBufLen = Math.max(128, analyser.frequencyBinCount || 128, analyser.fftSize || 256)
        const monData = new Float32Array(monBufLen)
        const monFreqData = new Float32Array(Math.max(32, analyser.frequencyBinCount || 128))
        let monLastSpeaking = false
        let monAboveCount = 0
        let monBelowCount = 0
        let smoothRms = 0
        let lastVoiceActivityDiagnosticsAt = 0
        // Hold after going quiet so short pauses inside one sentence do not drop the ring.
        // Keep release fairly short so keyboard clicks do not hold the gate open.
        useAppStore.getState().setVoiceSpeaking(useAppStore.getState().voiceSpeakingUserIds, false)
        // Keep sender track open at start to avoid "audio for 1s then silence" regressions
        // when RMS thresholds are too strict or context sampling starts late.
        applyVoiceActivityGate(true)

        const tick = () => {
            try {
                if (ctx.state !== 'closed' && ctx.state !== 'suspended') {
                    analyser.getFloatTimeDomainData(monData)
                    let sum = 0
                    for (let i = 0; i < monData.length; i++) sum += monData[i] * monData[i]
                    const rms = Math.sqrt(sum / monData.length)
                    const { onThr, offThr } = getThresholdsFromStorage()
                    analyser.getFloatFrequencyData(monFreqData)
                    const noiseSuppressionEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
                    const profile = getStoredVoiceInputProfile()
                    const aggressiveIsolation = shouldUseAggressiveVoiceIsolation(profile, noiseSuppressionEnabled)
                    const decision = evaluateVoiceGateFrame({
                        rms,
                        frequencyData: monFreqData,
                        sampleRate: ctx.sampleRate,
                        fftSize: analyser.fftSize,
                        onThr,
                        offThr,
                        noiseSuppressionEnabled,
                        aggressiveIsolation,
                        speaking: monLastSpeaking,
                        openFrames: monAboveCount,
                        belowFrames: monBelowCount,
                        smoothedRms: smoothRms,
                    })
                    monAboveCount = decision.openFrames
                    monBelowCount = decision.belowFrames
                    smoothRms = decision.smoothedRms
                    const speakingChanged = decision.speaking !== monLastSpeaking
                    if (speakingChanged) {
                        monLastSpeaking = decision.speaking
                        voiceActivitySpeakingRef.current = decision.speaking
                        applyVoiceActivityGate(decision.speaking)
                        useAppStore.getState().setVoiceSpeaking(
                            useAppStore.getState().voiceSpeakingUserIds,
                            decision.speaking,
                        )
                    }
                    const nowMs = Date.now()
                    if (nowMs - lastVoiceActivityDiagnosticsAt >= 750 || speakingChanged) {
                        lastVoiceActivityDiagnosticsAt = nowMs
                        updateVoiceDiagnostics({
                            voiceActivity: {
                                mode: getVoiceModeSettings().mode,
                                gateOpen: gateOpenRef.current,
                                speaking: decision.speaking,
                                rmsDb: linearToDbDiagnostic(rms),
                                smoothedRmsDb: linearToDbDiagnostic(decision.smoothedRms),
                                onThresholdDb: linearToDbDiagnostic(onThr),
                                offThresholdDb: linearToDbDiagnostic(offThr),
                                openFrames: decision.openFrames,
                                belowFrames: decision.belowFrames,
                            },
                        })
                    }
                }
            } catch {
                // ignore
            }
            inlineMonitorIntervalRef.current = requestAnimationFrame(tick)
        }
        inlineMonitorIntervalRef.current = requestAnimationFrame(tick)
    }, [applyVoiceActivityGate, cleanupMonitorNodes, getAudioContext, getVoiceModeSettings, localStream, resetVoiceActivityGate])

    useEffect(() => {
        if (!joinedChannelId) return
        const onKeyDown = (e: KeyboardEvent) => {
            const { mode, key } = getVoiceModeSettings()
            if (mode !== 'push_to_talk') return
            const pressed = e.key?.length === 1 ? e.key.toUpperCase() : e.key
            const target = key.length === 1 ? key.toUpperCase() : key
            if (pressed !== target) return
            pttPressedRef.current = true
            applyPushToTalkGate()
        }
        const onKeyUp = (e: KeyboardEvent) => {
            const { mode, key } = getVoiceModeSettings()
            if (mode !== 'push_to_talk') return
            const pressed = e.key?.length === 1 ? e.key.toUpperCase() : e.key
            const target = key.length === 1 ? key.toUpperCase() : key
            if (pressed !== target) return
            pttPressedRef.current = false
            applyPushToTalkGate()
        }
        const onSettingsChanged = () => {
            const nextMode = getStoredVoiceMode()
            setVoiceMode(nextMode)
            pttPressedRef.current = false
            if (nextMode === 'push_to_talk') {
                applyVoiceActivityGate(true)
            } else {
                applyVoiceActivityGate(voiceActivitySpeakingRef.current)
            }
            applyPushToTalkGate()
        }

        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
            window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener)
        }
    }, [applyPushToTalkGate, applyVoiceActivityGate, getVoiceModeSettings, joinedChannelId])

    useEffect(() => {
        if (!joinedChannelId) return

        const onVisibilityChange = () => {
            const { mode } = getVoiceModeSettings()
            if (mode !== 'voice_activity') return

            if (document.hidden) {
                // Browsers throttle requestAnimationFrame while backgrounded.
                // Keep the real mic sender attached so voice activity mode does
                // not get stuck publishing the silent gate track.
                applyVoiceActivityGate(true, { updateSpeakingRef: false })
                return
            }

            applyVoiceActivityGate(voiceActivitySpeakingRef.current)
        }

        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [applyVoiceActivityGate, getVoiceModeSettings, joinedChannelId])

    const stopLocalSpeakingMonitor = useCallback(() => {
        if (inlineMonitorIntervalRef.current != null) {
            window.cancelAnimationFrame(inlineMonitorIntervalRef.current)
            inlineMonitorIntervalRef.current = null
        }
        cleanupMonitorNodes()
        resetVoiceActivityGate()
        useAppStore.getState().setVoiceSpeaking([], false)
    }, [cleanupMonitorNodes, resetVoiceActivityGate])

    useEffect(() => {
        return () => {
            stopLocalSpeakingMonitor()
        }
    }, [stopLocalSpeakingMonitor])

    return {
        voiceMode,
        getVoiceModeSettings,
        startLocalSpeakingMonitor,
        stopLocalSpeakingMonitor
    }
}
