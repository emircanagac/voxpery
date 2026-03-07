import { useCallback, useRef } from 'react'
import { createRnnoiseNode, type RnnoiseNode } from '../rnnoise'

const SOUND_KEY = 'voxpery-settings-sound-enabled'

export type VoiceCueKind = 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen'

export function useAudioEngine() {
    const audioCtxRef = useRef<AudioContext | null>(null)

    const isSoundEnabled = useCallback(() => localStorage.getItem(SOUND_KEY) !== '0', [])

    const getAudioContext = useCallback((): AudioContext | null => {
        const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioCtor) return null
        if (!audioCtxRef.current) audioCtxRef.current = new AudioCtor()
        const ctx = audioCtxRef.current
        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => { })
        }
        return ctx
    }, [])

    const playVoiceCue = useCallback((kind: VoiceCueKind) => {
        if (!isSoundEnabled()) return
        const ctx = getAudioContext()
        if (!ctx) return

        const playTone = (opts: {
            from: number
            to?: number
            offsetSec: number
            durationSec: number
            wave?: OscillatorType
            peak?: number
        }) => {
            const {
                from,
                to,
                offsetSec,
                durationSec,
                wave = 'sine',
                peak = 0.026,
            } = opts
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            const startAt = ctx.currentTime + offsetSec
            const endAt = startAt + durationSec
            const attack = Math.max(0.006, Math.min(0.012, durationSec * 0.3))
            const releaseAt = startAt + Math.max(attack + 0.004, durationSec * 0.45)

            osc.type = wave
            osc.frequency.setValueAtTime(from, startAt)
            if (typeof to === 'number' && Number.isFinite(to) && to > 0) {
                osc.frequency.exponentialRampToValueAtTime(to, endAt)
            }
            gain.gain.setValueAtTime(0.0001, startAt)
            gain.gain.exponentialRampToValueAtTime(peak, startAt + attack)
            gain.gain.setValueAtTime(peak * 0.92, releaseAt)
            gain.gain.exponentialRampToValueAtTime(0.0001, endAt)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(startAt)
            osc.stop(endAt)
        }

        switch (kind) {
            case 'join':
                playTone({ from: 640, to: 820, offsetSec: 0, durationSec: 0.075, wave: 'triangle', peak: 0.024 })
                playTone({ from: 980, to: 1220, offsetSec: 0.085, durationSec: 0.1, wave: 'triangle', peak: 0.026 })
                break
            case 'leave':
                playTone({ from: 760, to: 600, offsetSec: 0, durationSec: 0.08, wave: 'triangle', peak: 0.024 })
                playTone({ from: 520, to: 390, offsetSec: 0.085, durationSec: 0.11, wave: 'sine', peak: 0.023 })
                break
            case 'mute':
                playTone({ from: 430, to: 350, offsetSec: 0, durationSec: 0.07, wave: 'square', peak: 0.019 })
                break
            case 'unmute':
                playTone({ from: 360, to: 520, offsetSec: 0, durationSec: 0.075, wave: 'triangle', peak: 0.023 })
                break
            case 'deafen':
                playTone({ from: 420, to: 330, offsetSec: 0, durationSec: 0.075, wave: 'sawtooth', peak: 0.02 })
                playTone({ from: 280, to: 220, offsetSec: 0.078, durationSec: 0.09, wave: 'sine', peak: 0.018 })
                break
            case 'undeafen':
                playTone({ from: 250, to: 320, offsetSec: 0, durationSec: 0.075, wave: 'triangle', peak: 0.02 })
                playTone({ from: 420, to: 590, offsetSec: 0.078, durationSec: 0.095, wave: 'triangle', peak: 0.024 })
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

    // Build the mic send pipeline: source → [RNNoise] → volumeGain → destination.
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

        // RNNoise ML denoiser (bypasses transparently when disabled)
        rnnoiseRef.current?.destroy()
        const rnnoise = await createRnnoiseNode(ctx, noiseSuppressionEnabled)
        rnnoiseRef.current = rnnoise

        const volumeGainNode = ctx.createGain()
        volumeGainNode.gain.value = volumeFactor
        const destination = ctx.createMediaStreamDestination()

        // VAD tap: post-RNNoise, pre-volume — speaking indicator reflects
        // the denoised signal so background noise won't light up the ring.
        const vadDestination = ctx.createMediaStreamDestination()

        source.connect(rnnoise.node)
        rnnoise.node.connect(volumeGainNode)
        rnnoise.node.connect(vadDestination)   // branch for VAD analyser
        volumeGainNode.connect(destination)

        const processedTrack = destination.stream.getAudioTracks()[0]
        if (!processedTrack) return { track: rawTrack, vadStream: sourceStream, cancelGate: () => {} }

        inputGainNodeRef.current = volumeGainNode

        return { track: processedTrack, vadStream: vadDestination.stream, cancelGate: () => {} }
    }, [getAudioContext])

    /** Toggle RNNoise on/off without rebuilding the audio graph. */
    const setRnnoiseEnabled = useCallback((enabled: boolean) => {
        rnnoiseRef.current?.setEnabled(enabled)
    }, [])

    const destroyRnnoise = useCallback(() => {
        rnnoiseRef.current?.destroy()
        rnnoiseRef.current = null
    }, [])

    return { getAudioContext, playVoiceCue, disconnectAudioContext, buildMicSendTrack, setRnnoiseEnabled, destroyRnnoise }
}
