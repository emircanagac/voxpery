import { useCallback, useRef } from 'react'

const SCREEN_SHARE_QUALITY_KEY = 'voxpery-settings-screen-share-quality'
const INPUT_VOL_KEY = 'voxpery-settings-input-volume'

type ScreenShareResolution = '720p' | '1080p'
type ScreenShareFramerate = 30 | 60
type ScreenShareQuality = 'auto' | 'presentation' | 'video' | 'gaming'

type ScreenShareProfile = {
    resolution: ScreenShareResolution
    framerate: ScreenShareFramerate
    bitrate: number
    contentHint: 'detail' | 'motion'
}

const PRESET_PROFILE: Record<Exclude<ScreenShareQuality, 'auto'>, ScreenShareProfile> = {
    presentation: { resolution: '1080p', framerate: 30, bitrate: 6_000_000, contentHint: 'detail' },
    video: { resolution: '1080p', framerate: 60, bitrate: 10_000_000, contentHint: 'motion' },
    gaming: { resolution: '1080p', framerate: 60, bitrate: 12_000_000, contentHint: 'motion' },
}

export function useLocalMedia() {
    const cachedMicStreamRef = useRef<MediaStream | null>(null)
    const cachedScreenStreamRef = useRef<MediaStream | null>(null)

    const resolveQualityMode = useCallback((): ScreenShareQuality => {
        const raw = localStorage.getItem(SCREEN_SHARE_QUALITY_KEY)
        if (raw === 'manual') {
            try { localStorage.setItem(SCREEN_SHARE_QUALITY_KEY, 'auto') } catch { /* ignore */ }
            return 'auto'
        }
        if (raw === 'presentation' || raw === 'video' || raw === 'gaming') return raw
        return 'auto'
    }, [])

    const resolveScreenShareProfile = useCallback((displaySurface?: string): ScreenShareProfile => {
        const mode = resolveQualityMode()
        if (mode === 'presentation' || mode === 'video' || mode === 'gaming') {
            return PRESET_PROFILE[mode]
        }

        if (displaySurface === 'monitor') return PRESET_PROFILE.gaming
        if (displaySurface === 'browser') return PRESET_PROFILE.video
        return PRESET_PROFILE.presentation
    }, [resolveQualityMode])

    const getScreenShareConstraints = useCallback((): DisplayMediaStreamOptions['video'] => {
        const profile = resolveScreenShareProfile()
        const base = { frameRate: { ideal: profile.framerate } as MediaTrackConstraintSet['frameRate'] }
        switch (profile.resolution) {
            case '1080p':
                return { ...base, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } }
            case '720p':
            default:
                return { ...base, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } }
        }
    }, [resolveScreenShareProfile])

    // Apply mic constraints (echo cancellation + auto gain).
    // Noise suppression is handled by RNNoise in the audio pipeline.
    const applyLocalMicSettings = useCallback(async (audioTrack: MediaStreamTrack | null) => {
        if (!audioTrack || typeof audioTrack.applyConstraints !== 'function') return
        const constraintsBase: MediaTrackConstraints = {
            noiseSuppression: false,
            echoCancellation: true,
            autoGainControl: true,
        }
        try {
            await audioTrack.applyConstraints(constraintsBase)
        } catch {
            // ignore unsupported constraints
        }
    }, [])

    const getMicrophoneStream = useCallback(async (): Promise<MediaStream> => {
        if (cachedMicStreamRef.current) {
            return cachedMicStreamRef.current
        }
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Microphone access is not supported in this browser')
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: false,
                    echoCancellation: true,
                    autoGainControl: true,
                },
                video: false,
            })
            cachedMicStreamRef.current = stream
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
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
            audio: true,
        })
        cachedScreenStreamRef.current = stream
        return stream
    }, [getScreenShareConstraints])

    /** Returns LiveKit-compatible videoEncoding and content hint based on quality mode. */
    const getScreenShareEncoding = useCallback((videoTrack?: MediaStreamTrack): {
        maxBitrate: number
        maxFramerate: number
        contentHint: 'detail' | 'motion'
    } => {
        const displaySurface = videoTrack?.getSettings?.().displaySurface
        const profile = resolveScreenShareProfile(displaySurface)
        return {
            maxBitrate: profile.bitrate,
            maxFramerate: profile.framerate,
            contentHint: profile.contentHint,
        }
    }, [resolveScreenShareProfile])

    const getInputVolumeFactor = useCallback(() => {
        const raw = Math.min(100, Math.max(1, Number(localStorage.getItem(INPUT_VOL_KEY)) || 100))
        return raw / 100
    }, [])

    const cleanupLocalMedia = useCallback(() => {
        cachedMicStreamRef.current?.getTracks().forEach(t => t.stop())
        cachedMicStreamRef.current = null
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
