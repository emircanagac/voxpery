import { useCallback, useRef } from 'react'
import { createRnnoiseNode, type RnnoiseNode } from '../rnnoise'
import { getOrCreateAudioContext, playCueStack } from '../../audioCues'

const SOUND_KEY = 'voxpery-settings-sound-enabled'

export type VoiceCueKind = 'join' | 'leave' | 'mute' | 'unmute' | 'deafen' | 'undeafen'

export function useAudioEngine() {
    const audioCtxRef = useRef<AudioContext | null>(null)

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
