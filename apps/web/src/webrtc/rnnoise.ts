/**
 * RNNoise WASM integration for ML-based noise suppression.
 *
 * Uses an AudioWorkletNode to feed mic audio through RNNoise's
 * denoiser in 480-sample frames (10 ms at 48 kHz). A ring buffer
 * inside the worklet processor bridges the 128-sample render quanta
 * with the 480-frame size so no audio is lost or sped up.
 *
 * Adds about 10 ms latency, which is imperceptible for voice chat.
 */

import { updateVoiceDiagnostics, type RnnoiseRuntimeStatus } from './voiceDiagnostics'

// Prod: define injects URL so main bundle has no worklet dependency. Dev: Vite serves from source.
declare const __RNNOISE_PROCESSOR_URL__: string | undefined
const processorUrl =
  typeof __RNNOISE_PROCESSOR_URL__ !== 'undefined'
    ? __RNNOISE_PROCESSOR_URL__
    : (import.meta.env.DEV
        ? new URL('./rnnoise-worklet-processor.ts', import.meta.url).href
        : ((import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') + '/assets/rnnoise-worklet.js'))

/**
 * Tracks whether addModule has already been called for a given
 * AudioContext so we do not re-register the processor needlessly.
 */
const registeredContexts = new WeakSet<AudioContext>()

async function ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
  if (registeredContexts.has(ctx)) return
  updateVoiceDiagnostics({ rnnoiseWorkletUrl: processorUrl })
  await ctx.audioWorklet.addModule(processorUrl)
  registeredContexts.add(ctx)
}

let preloadStarted = false

/**
 * Preload the worklet script (fetch + parse) so the first voice join is faster.
 * Call after a user gesture or on voice channel hover. Uses a temporary
 * AudioContext then closes it; the script is cached so the real join only pays
 * parse/compile cost. Idempotent: only runs once per page load.
 */
export function preloadRnnoiseWorklet(): void {
  if (preloadStarted) return
  preloadStarted = true
  const AudioCtor = typeof window !== 'undefined' && (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  if (!AudioCtor) return
  const ctx = new AudioCtor()
  ensureWorkletRegistered(ctx)
    .then(() => ctx.close())
    .catch(() => ctx.close())
}

export interface RnnoiseNode {
  /** AudioWorkletNode to insert into the Web Audio graph. */
  node: AudioWorkletNode
  /** Current runtime state for production parity diagnostics. */
  getStatus: () => RnnoiseRuntimeStatus
  /** Wait for the denoiser to become ready, or return the terminal/timeout status. */
  waitUntilReady: (timeoutMs?: number) => Promise<RnnoiseRuntimeStatus>
  /** Toggle noise suppression on/off without rebuilding the graph. */
  setEnabled: (v: boolean) => void
  /** Release WASM memory and disconnect the node. */
  destroy: () => void
}

/**
 * Create an AudioWorkletNode that runs RNNoise on every mic frame.
 *
 * When `enabled` is false the node acts as a transparent passthrough.
 * While WASM is still loading it briefly outputs silence so raw background
 * noise does not leak before RNNoise is ready.
 */
export async function createRnnoiseNode(
  ctx: AudioContext,
  enabled: boolean,
): Promise<RnnoiseNode> {
  await ensureWorkletRegistered(ctx)

  const node = new AudioWorkletNode(ctx, 'rnnoise-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { enabled },
  })

  let destroyed = false
  let status: RnnoiseRuntimeStatus = enabled ? 'loading' : 'disabled'
  let hasReadyProcessor = false
  let fallbackAfterTimeout = false
  let readyListeners: Array<(status: RnnoiseRuntimeStatus) => void> = []

  const setStatus = (next: RnnoiseRuntimeStatus, rnnoiseError?: string) => {
    status = next
    updateVoiceDiagnostics({
      rnnoiseStatus: next,
      rnnoiseError,
      rnnoiseWorkletUrl: processorUrl,
    })
    if (next === 'ready' || next === 'failed' || next === 'disabled') {
      const listeners = readyListeners
      readyListeners = []
      listeners.forEach((listener) => listener(next))
    }
  }

  type ProcessorMessage = {
    type: 'ready' | 'load-failed' | 'process-failed'
    message?: string
  }

  setStatus(status)

  node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
    if (destroyed) return
    const data = event.data
    if (data.type === 'ready') {
      hasReadyProcessor = true
      if (!fallbackAfterTimeout) setStatus('ready')
    } else if (data.type === 'load-failed' || data.type === 'process-failed') {
      setStatus('failed', data.message ?? 'RNNoise processor failed')
    }
  }

  node.onprocessorerror = () => {
    if (!destroyed) setStatus('failed', 'RNNoise AudioWorklet processor crashed')
  }

  return {
    node,
    getStatus() {
      return status
    },
    waitUntilReady(timeoutMs = 3500) {
      if (status === 'ready' || status === 'failed' || status === 'disabled') {
        return Promise.resolve(status)
      }
      return new Promise((resolve) => {
        let settled = false
        const finish = (next: RnnoiseRuntimeStatus) => {
          if (settled) return
          settled = true
          window.clearTimeout(timeout)
          resolve(next)
        }
        const timeout = window.setTimeout(() => {
          fallbackAfterTimeout = true
          setStatus('failed', `RNNoise did not become ready within ${timeoutMs}ms`)
          node.port.postMessage({ type: 'set-enabled', enabled: false })
          finish('failed')
        }, timeoutMs)
        readyListeners.push(finish)
      })
    },
    setEnabled(v: boolean) {
      if (!destroyed) {
        if (v) fallbackAfterTimeout = false
        setStatus(v ? (hasReadyProcessor ? 'ready' : 'loading') : 'disabled')
        node.port.postMessage({ type: 'set-enabled', enabled: v })
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      setStatus('disabled')
      node.port.postMessage({ type: 'destroy' })
      node.disconnect()
    },
  }
}
