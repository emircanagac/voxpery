import { useCallback, useRef } from 'react'
import {
    applyMicTrackProcessingConstraints,
    getPreferredMicrophoneStream,
    getStoredVoiceInputDeviceId,
} from '../../voiceDevices'

export const SCREEN_SHARE_QUALITY_KEY = 'voxpery-settings-screen-share-quality'
export const SCREEN_SHARE_CAPTURE_READY_EVENT = 'voxpery-screen-share-capture-ready'
const INPUT_VOL_KEY = 'voxpery-settings-input-volume'
const NOISE_SUPPRESSION_KEY = 'voxpery-settings-noise-suppression'
const DEFAULT_INPUT_VOLUME = 80

export type ScreenShareResolution = '720p' | '1080p'
export type ScreenShareFramerate = 30 | 60
export type ScreenShareQuality = 'auto' | 'presentation' | 'video' | 'gaming'
export type ScreenShareDegradationPreference = 'maintain-resolution' | 'maintain-framerate'

export type ScreenShareProfile = {
    resolution: ScreenShareResolution
    framerate: ScreenShareFramerate
    bitrate: number
    contentHint: 'detail' | 'motion'
    degradationPreference: ScreenShareDegradationPreference
}

export const SCREEN_SHARE_PRESET_PROFILE: Record<Exclude<ScreenShareQuality, 'auto'>, ScreenShareProfile> = {
    presentation: {
        resolution: '1080p',
        framerate: 30,
        bitrate: 4_000_000,
        contentHint: 'detail',
        degradationPreference: 'maintain-resolution',
    },
    video: {
        resolution: '1080p',
        framerate: 60,
        bitrate: 6_000_000,
        contentHint: 'motion',
        degradationPreference: 'maintain-framerate',
    },
    gaming: {
        resolution: '1080p',
        framerate: 60,
        bitrate: 8_000_000,
        contentHint: 'motion',
        degradationPreference: 'maintain-framerate',
    },
}

export function normalizeScreenShareQuality(value: string | null | undefined): ScreenShareQuality {
    if (value === 'presentation' || value === 'video' || value === 'gaming') return value
    return 'auto'
}

export function resolveScreenShareProfileForMode(
    mode: ScreenShareQuality,
    displaySurface?: string,
): ScreenShareProfile {
    if (mode === 'presentation' || mode === 'video' || mode === 'gaming') {
        return SCREEN_SHARE_PRESET_PROFILE[mode]
    }

    if (displaySurface === 'monitor') return SCREEN_SHARE_PRESET_PROFILE.video
    if (displaySurface === 'browser') return SCREEN_SHARE_PRESET_PROFILE.video
    return SCREEN_SHARE_PRESET_PROFILE.presentation
}

export function toScreenShareConstraintsForProfile(profile: ScreenShareProfile): MediaTrackConstraints {
    const base = { frameRate: { ideal: profile.framerate, max: profile.framerate } as MediaTrackConstraintSet['frameRate'] }
    switch (profile.resolution) {
        case '1080p':
            return { ...base, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } }
        case '720p':
        default:
            return { ...base, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } }
    }
}

type DisplayAudioConstraints = MediaTrackConstraints & {
    suppressLocalAudioPlayback: boolean
}

export function toScreenShareDisplayMediaOptions(
    video: DisplayMediaStreamOptions['video'],
): DisplayMediaStreamOptions {
    return {
        video,
        audio: {
            // Keep the active call audible while the native/macOS share picker changes focus.
            suppressLocalAudioPlayback: false,
        } as DisplayAudioConstraints,
    }
}

export function useLocalMedia() {
    const cachedMicStreamRef = useRef<MediaStream | null>(null)
    const cachedMicDeviceIdRef = useRef<string>('')
    const cachedScreenStreamRef = useRef<MediaStream | null>(null)

    const resolveQualityMode = useCallback((): ScreenShareQuality => {
        const raw = localStorage.getItem(SCREEN_SHARE_QUALITY_KEY)
        if (raw === 'manual') {
            try { localStorage.setItem(SCREEN_SHARE_QUALITY_KEY, 'auto') } catch { /* ignore */ }
            return 'auto'
        }
        return normalizeScreenShareQuality(raw)
    }, [])

    const resolveScreenShareProfile = useCallback((displaySurface?: string): ScreenShareProfile => {
        return resolveScreenShareProfileForMode(resolveQualityMode(), displaySurface)
    }, [resolveQualityMode])

    const toScreenShareConstraints = useCallback((profile: ScreenShareProfile): MediaTrackConstraints => {
        return toScreenShareConstraintsForProfile(profile)
    }, [])

    const getScreenShareConstraints = useCallback((): DisplayMediaStreamOptions['video'] => {
        const mode = resolveQualityMode()
        const profile = mode === 'auto' ? SCREEN_SHARE_PRESET_PROFILE.video : resolveScreenShareProfile()
        return toScreenShareConstraints(profile)
    }, [resolveQualityMode, resolveScreenShareProfile, toScreenShareConstraints])

    const applyScreenShareTrackProfile = useCallback(async (videoTrack: MediaStreamTrack | undefined) => {
        if (!videoTrack) return
        const profile = resolveScreenShareProfile(videoTrack.getSettings?.().displaySurface)
        if ('contentHint' in videoTrack) {
            try { videoTrack.contentHint = profile.contentHint } catch { /* ignore */ }
        }
        try {
            await videoTrack.applyConstraints(toScreenShareConstraints(profile))
        } catch {
            // Browsers may refuse post-selection display constraints; publish encoding still caps bandwidth/FPS.
        }
    }, [resolveScreenShareProfile, toScreenShareConstraints])

    // Apply browser-level mic constraints.
    // Keep browser noise suppression in sync with user setting as a safe fallback
    // in case RNNoise cannot initialize on a specific client/runtime.
    const applyLocalMicSettings = useCallback(async (audioTrack: MediaStreamTrack | null) => {
        const noiseSuppressionEnabled = localStorage.getItem(NOISE_SUPPRESSION_KEY) !== '0'
        await applyMicTrackProcessingConstraints(audioTrack, noiseSuppressionEnabled)
    }, [])

    const getMicrophoneStream = useCallback(async (forceRefresh = false): Promise<MediaStream> => {
        const preferredDeviceId = getStoredVoiceInputDeviceId()
        if (
            !forceRefresh
            && cachedMicStreamRef.current
            && cachedMicDeviceIdRef.current === preferredDeviceId
            && cachedMicStreamRef.current.getAudioTracks().some((track) => track.readyState === 'live')
        ) {
            return cachedMicStreamRef.current
        }
        cachedMicStreamRef.current?.getTracks().forEach((track) => track.stop())
        cachedMicStreamRef.current = null
        try {
            const stream = await getPreferredMicrophoneStream()
            cachedMicStreamRef.current = stream
            cachedMicDeviceIdRef.current = getStoredVoiceInputDeviceId()
            return stream
        } catch (err: unknown) {
            const name = (err as { name?: string })?.name ?? ''
            if (name === 'NotAllowedError') throw new Error('Microphone permission denied')
            if (name === 'NotFoundError') throw new Error('No microphone device detected')
            if (name === 'NotReadableError') throw new Error('Microphone is in use by another app')
            throw new Error('Unable to access microphone')
        }
    }, [])

    const getCameraStream = useCallback(async (): Promise<MediaStream> => {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Camera access is not supported in this browser')
        }

        const attempts: MediaStreamConstraints[] = [
            {
                audio: false,
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30, max: 30 },
                },
            },
            {
                audio: false,
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30, max: 30 },
                },
            },
            { audio: false, video: true },
        ]

        let lastErr: unknown = null
        for (const constraints of attempts) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia(constraints)
                if (stream.getVideoTracks().length > 0) {
                    return stream
                }
                stream.getTracks().forEach((t) => t.stop())
                lastErr = new Error('No camera video track available')
            } catch (err) {
                lastErr = err
                const name = (err as { name?: string })?.name ?? ''
                if (name === 'NotAllowedError' || name === 'SecurityError') {
                    break
                }
            }
        }

        const name = (lastErr as { name?: string })?.name ?? ''
        const message = String((lastErr as { message?: unknown })?.message ?? '').toLowerCase()

        if (name === 'NotAllowedError' || name === 'SecurityError') throw new Error('Camera permission denied')
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') throw new Error('No camera device detected')
        if (name === 'NotReadableError' || message.includes('in use') || message.includes('busy')) {
            throw new Error('Camera is in use by another app')
        }
        if (message.includes('failed to allocate videosource')) {
            throw new Error('Failed to allocate camera video source')
        }
        throw new Error('Unable to access camera')
    }, [])

    const getScreenStream = useCallback(async (): Promise<MediaStream> => {
        const cached = cachedScreenStreamRef.current
        if (cached) {
            const video = cached.getVideoTracks()[0]
            if (video?.readyState === 'live') return cached
            cached.getTracks().forEach((t) => t.stop())
            cachedScreenStreamRef.current = null
        }
        const videoConstraints = getScreenShareConstraints()
        const stream = await navigator.mediaDevices.getDisplayMedia(
            toScreenShareDisplayMediaOptions(videoConstraints),
        )
        await applyScreenShareTrackProfile(stream.getVideoTracks()[0])
        cachedScreenStreamRef.current = stream
        window.dispatchEvent(new Event(SCREEN_SHARE_CAPTURE_READY_EVENT))
        return stream
    }, [applyScreenShareTrackProfile, getScreenShareConstraints])

    /** Returns LiveKit-compatible videoEncoding and content hint based on quality mode. */
    const getScreenShareEncoding = useCallback((videoTrack?: MediaStreamTrack): {
        maxBitrate: number
        maxFramerate: number
        contentHint: 'detail' | 'motion'
        degradationPreference: ScreenShareDegradationPreference
    } => {
        const displaySurface = videoTrack?.getSettings?.().displaySurface
        const profile = resolveScreenShareProfile(displaySurface)
        return {
            maxBitrate: profile.bitrate,
            maxFramerate: profile.framerate,
            contentHint: profile.contentHint,
            degradationPreference: profile.degradationPreference,
        }
    }, [resolveScreenShareProfile])

    const getInputVolumeFactor = useCallback(() => {
        const raw = Math.min(100, Math.max(1, Number(localStorage.getItem(INPUT_VOL_KEY)) || DEFAULT_INPUT_VOLUME))
        return raw / 100
    }, [])

    const cleanupLocalMedia = useCallback(() => {
        cachedMicStreamRef.current?.getTracks().forEach(t => t.stop())
        cachedMicStreamRef.current = null
        cachedMicDeviceIdRef.current = ''
        cachedScreenStreamRef.current?.getTracks().forEach(t => t.stop())
        cachedScreenStreamRef.current = null
    }, [])

    return {
        getScreenShareConstraints,
        getScreenShareEncoding,
        applyLocalMicSettings,
        getMicrophoneStream,
        getCameraStream,
        getScreenStream,
        getInputVolumeFactor,
        cleanupLocalMedia
    }
}
