/**
 * RNNoise WASM integration for ML-based noise suppression.
 *
 * Uses an AudioWorkletNode to feed mic audio through RNNoise's
 * denoiser in 480-sample frames (10 ms at 48 kHz).  A ring-buffer
 * inside the worklet processor bridges the 128-sample render quanta
 * with the 480-frame size so no audio is lost or sped up.
 *
 * Adds ~10 ms latency — imperceptible for voice chat.
 */

/* ── module-level worklet registration ──────────────────────────── */

// Prod: define injects URL so main bundle has no worklet dependency (no extra chunk). Dev: Vite serves from source.
declare const __RNNOISE_PROCESSOR_URL__: string | undefined
const processorUrl =
  typeof __RNNOISE_PROCESSOR_URL__ !== 'undefined'
    ? __RNNOISE_PROCESSOR_URL__
    : (import.meta.env.DEV
        ? new URL('./rnnoise-worklet-processor.ts', import.meta.url).href
        : ((import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') + '/assets/rnnoise-worklet.js'))

/**
 * Tracks whether addModule has already been called for a given
 * AudioContext so we don't re-register the processor needlessly.
 */
const registeredContexts = new WeakSet<AudioContext>()

async function ensureWorkletRegistered(ctx: AudioContext): Promise<void> {
  if (registeredContexts.has(ctx)) return
  await ctx.audioWorklet.addModule(processorUrl)
  registeredContexts.add(ctx)
}

let preloadStarted = false

/**
 * Preload the worklet script (fetch + parse) so the first voice join is faster.
 * Call after a user gesture (e.g. first click) or on voice channel hover. Uses a temporary
 * AudioContext then closes it; the script is cached so the real join only pays parse/compile cost.
 * Idempotent: only runs once per page load.
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

/* ── public interface ───────────────────────────────────────────── */

export interface RnnoiseNode {
  /** AudioWorkletNode to insert into the Web Audio graph. */
  node: AudioWorkletNode
  /** Toggle noise suppression on/off without rebuilding the graph. */
  setEnabled: (v: boolean) => void
  /** Release WASM memory and disconnect the node. */
  destroy: () => void
}

/**
 * Create an AudioWorkletNode that runs RNNoise on every mic frame.
 *
 * When `enabled` is false (or while WASM is still loading) the node
 * acts as a transparent passthrough — zero processing cost.
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

  return {
    node,
    setEnabled(v: boolean) {
      if (!destroyed) {
        node.port.postMessage({ type: 'set-enabled', enabled: v })
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      node.port.postMessage({ type: 'destroy' })
      node.disconnect()
    },
  }
}
