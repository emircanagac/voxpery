import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalAudioTrack } from 'livekit-client'
import { useAppStore } from '../../stores/app'
import { getThresholdsFromStorage } from '../sensitivityThreshold'

const VOICE_MODE_KEY = 'voxpery-settings-voice-mode'
const PTT_KEY_KEY = 'voxpery-settings-ptt-key'
const SETTINGS_CHANGED_EVENT = 'voxpery-voice-settings-changed'

export type VoiceMode = 'voice_activity' | 'push_to_talk'

export function useVoiceActivity(options: {
    userId: string | null
    joinedChannelId: string | null
    localStream: MediaStream | null
    getAudioContext: () => AudioContext | null
    setLocalMicMuted: (muted: boolean) => Promise<void>
    localAudioTrackRef: React.MutableRefObject<LocalAudioTrack | null>
}) {
    const { userId, joinedChannelId, localStream, getAudioContext, setLocalMicMuted, localAudioTrackRef } = options
    const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => {
        const modeRaw = localStorage.getItem(VOICE_MODE_KEY)
        return modeRaw === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
    })

    const pttPressedRef = useRef(false)
    const voiceActivitySpeakingRef = useRef(false)
    const inlineMonitorIntervalRef = useRef<number | null>(null)

    const getVoiceModeSettings = useCallback(() => {
        const modeRaw = localStorage.getItem(VOICE_MODE_KEY)
        const mode = modeRaw === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
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

    // ── VAD gate: directly swap the RTCRtpSender's track ──
    // We go straight to the WebRTC layer: save the sender's real track,
    // then swap it with a silent track when below threshold.
    const realSenderTrackRef = useRef<MediaStreamTrack | null>(null)
    const silentTrackRef = useRef<MediaStreamTrack | null>(null)
    const gateOpenRef = useRef(true)

    const applyVoiceActivityGate = useCallback((speaking: boolean) => {
        voiceActivitySpeakingRef.current = speaking
        const { mode } = getVoiceModeSettings()
        if (mode !== 'voice_activity') return
        // Don't override manual mute/deafen
        if (userId) {
            const control = useAppStore.getState().voiceControls[userId]
            if (control?.muted || control?.deafened) return
        }

        const track = localAudioTrackRef.current
        const sender = (track as unknown as { sender?: RTCRtpSender })?.sender
        if (!sender) return

        if (speaking && !gateOpenRef.current) {
            // ── OPEN gate: restore real track ──
            gateOpenRef.current = true
            if (realSenderTrackRef.current) {
                void sender.replaceTrack(realSenderTrackRef.current)
            }
        } else if (!speaking && gateOpenRef.current) {
            // ── CLOSE gate: swap to silence ──
            gateOpenRef.current = false
            // Save the real track on first close
            if (!realSenderTrackRef.current && sender.track) {
                realSenderTrackRef.current = sender.track
            }
            // Lazily create a silent track
            if (!silentTrackRef.current) {
                try {
                    const ctx = new AudioContext()
                    const osc = ctx.createOscillator()
                    const gain = ctx.createGain()
                    gain.gain.value = 0
                    const dest = ctx.createMediaStreamDestination()
                    osc.connect(gain)
                    gain.connect(dest)
                    osc.start()
                    silentTrackRef.current = dest.stream.getAudioTracks()[0]
                } catch {
                    return
                }
            }
            void sender.replaceTrack(silentTrackRef.current)
        }
    }, [getVoiceModeSettings, userId, localAudioTrackRef])

    const startLocalSpeakingMonitor = useCallback((streamOverride?: MediaStream | null) => {
        const stream = streamOverride ?? localStream
        if (!stream) return
        const ctx = getAudioContext()
        if (!ctx) return

        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        // Keep attack snappy so the ring lights up as soon as speech starts,
        // while release smoothness is handled below with hold + RMS smoothing.
        analyser.smoothingTimeConstant = 0.16
        source.connect(analyser)

        const monBufLen = Math.max(128, analyser.frequencyBinCount || 128, analyser.fftSize || 256)
        const monData = new Float32Array(monBufLen)
        let monLastSpeaking = false
        let monBelowCount = 0
        let smoothRms = 0
        // Hold after going quiet so short pauses inside one sentence do not drop the ring.
        // ~52 frames @ 60fps ≈ 860ms.
        const monHoldFrames = 52
        // Stronger smoothing on release keeps the indicator feeling steadier mid-speech.
        const smoothAlpha = 0.96

        if (inlineMonitorIntervalRef.current != null) {
            cancelAnimationFrame(inlineMonitorIntervalRef.current)
            inlineMonitorIntervalRef.current = null
        }

        useAppStore.getState().setVoiceSpeaking(useAppStore.getState().voiceSpeakingUserIds, false)
        applyVoiceActivityGate(false) // Initially mute until we actually speak

        const tick = () => {
            try {
                if (ctx.state !== 'closed' && ctx.state !== 'suspended') {
                    analyser.getFloatTimeDomainData(monData)
                    let sum = 0
                    for (let i = 0; i < monData.length; i++) sum += monData[i] * monData[i]
                    const rms = Math.sqrt(sum / monData.length)
                    const { onThr, offThr } = getThresholdsFromStorage()

                    // Check if the remaining audio (voice) is loud enough to pass
                    // the user's Sensitivity Threshold.
                    if (rms >= onThr) {
                        monBelowCount = 0
                        smoothRms = smoothAlpha * smoothRms + (1 - smoothAlpha) * rms
                        if (!monLastSpeaking) {
                            monLastSpeaking = true
                            voiceActivitySpeakingRef.current = true
                            applyVoiceActivityGate(true)
                            useAppStore.getState().setVoiceSpeaking(useAppStore.getState().voiceSpeakingUserIds, true)
                        }
                    } else if (monLastSpeaking) {
                        smoothRms = smoothAlpha * smoothRms + (1 - smoothAlpha) * rms
                        // Use smoothed RMS for turn-off: brief mid-speech dips don't close the ring (Discord-like).
                        if (smoothRms >= offThr) { monBelowCount = 0 }
                        else {
                            monBelowCount++
                            if (monBelowCount >= monHoldFrames) {
                                monLastSpeaking = false
                                monBelowCount = 0
                                voiceActivitySpeakingRef.current = false
                                applyVoiceActivityGate(false)
                                useAppStore.getState().setVoiceSpeaking(useAppStore.getState().voiceSpeakingUserIds, false)
                            }
                        }
                    }
                }
            } catch {
                // ignore
            }
            inlineMonitorIntervalRef.current = requestAnimationFrame(tick)
        }
        inlineMonitorIntervalRef.current = requestAnimationFrame(tick)
    }, [applyVoiceActivityGate, getAudioContext, localStream])

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
            const nextModeRaw = localStorage.getItem(VOICE_MODE_KEY)
            const nextMode = nextModeRaw === 'push_to_talk' ? 'push_to_talk' : 'voice_activity'
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

    const stopLocalSpeakingMonitor = useCallback(() => {
        if (inlineMonitorIntervalRef.current != null) {
            window.cancelAnimationFrame(inlineMonitorIntervalRef.current)
            inlineMonitorIntervalRef.current = null
        }
        useAppStore.getState().setVoiceSpeaking([], false)
    }, [])

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
