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

// Use ?url so Vite emits the worklet as a real .js chunk (not inlined); required for addModule() in production.
import processorUrl from './rnnoise-worklet-processor.ts?url'

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
