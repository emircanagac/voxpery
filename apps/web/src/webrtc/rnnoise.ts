/**
 * RNNoise WASM integration for ML-based noise suppression.
 *
 * Uses a ScriptProcessorNode to feed mic audio through RNNoise's
 * denoiser in 480-sample frames (10 ms at 48 kHz).  A ring-buffer
 * bridges the 480-frame size with the 4096-sample callback chunks
 * so no audio is lost or sped up.
 *
 * Adds ~10 ms latency — imperceptible for voice chat.
 */

import type { Rnnoise, DenoiseState } from '@shiguredo/rnnoise-wasm'

/* ── singleton WASM loader ──────────────────────────────────────── */

let rnnoiseInstance: Rnnoise | null = null
let loadPromise: Promise<Rnnoise> | null = null

async function getRnnoise(): Promise<Rnnoise> {
  if (rnnoiseInstance) return rnnoiseInstance
  if (!loadPromise) {
    loadPromise = import('@shiguredo/rnnoise-wasm')
      .then(m => m.Rnnoise.load())
      .then(r => { rnnoiseInstance = r; return r })
  }
  return loadPromise
}

/* ── constants ──────────────────────────────────────────────────── */

const FRAME_SIZE = 480          // RNNoise expects exactly 480 samples
const PCM_SCALE  = 32767.0      // RNNoise works with 16-bit PCM range
const RING_BITS  = 14           // 2^14 = 16 384  (power-of-2 for bitmask)
const RING_SIZE  = 1 << RING_BITS
const RING_MASK  = RING_SIZE - 1

/* ── public interface ───────────────────────────────────────────── */

export interface RnnoiseNode {
  /** ScriptProcessorNode to insert into the Web Audio graph. */
  node: ScriptProcessorNode
  /** Toggle noise suppression on/off without rebuilding the graph. */
  setEnabled: (v: boolean) => void
  /** Release WASM memory and disconnect the node. */
  destroy: () => void
}

/**
 * Create a ScriptProcessorNode that runs RNNoise on every mic frame.
 *
 * When `enabled` is false (or while WASM is still loading) the node
 * acts as a transparent passthrough — zero processing cost.
 */
export function createRnnoiseNode(
  ctx: AudioContext,
  enabled: boolean,
): RnnoiseNode {
  let denoiseState: DenoiseState | null = null
  let isEnabled = enabled
  let destroyed = false

  /* ring buffers (zero-alloc in the hot path) */
  const inRing  = new Float32Array(RING_SIZE)
  const outRing = new Float32Array(RING_SIZE)
  const frame   = new Float32Array(FRAME_SIZE)
  let inW = 0, inR = 0
  let outW = 0, outR = 0
  let preloaded = false

  const avail = (w: number, r: number) => (w - r + RING_SIZE) & RING_MASK

  /* eagerly load WASM when initially enabled */
  if (isEnabled) {
    void getRnnoise().then(r => {
      if (!destroyed) denoiseState = r.createDenoiseState()
    })
  }

  /* 4096 buffer = ~85 ms at 48 kHz — comfortably holds multiple 480-frames */
  const node = ctx.createScriptProcessor(4096, 1, 1)

  node.onaudioprocess = (e: AudioProcessingEvent) => {
    const input  = e.inputBuffer.getChannelData(0)
    const output = e.outputBuffer.getChannelData(0)

    if (!isEnabled || !denoiseState) {
      output.set(input)
      return
    }

    /* first run: pre-fill output ring with 1 frame of silence for latency */
    if (!preloaded) {
      outW = FRAME_SIZE
      preloaded = true
    }

    /* push raw mic samples into input ring */
    for (let i = 0; i < input.length; i++) {
      inRing[inW] = input[i]
      inW = (inW + 1) & RING_MASK
    }

    /* process all complete 480-sample frames */
    while (avail(inW, inR) >= FRAME_SIZE) {
      for (let j = 0; j < FRAME_SIZE; j++) {
        frame[j] = inRing[(inR + j) & RING_MASK] * PCM_SCALE
      }
      inR = (inR + FRAME_SIZE) & RING_MASK

      denoiseState.processFrame(frame)

      for (let j = 0; j < FRAME_SIZE; j++) {
        outRing[(outW + j) & RING_MASK] = frame[j] / PCM_SCALE
      }
      outW = (outW + FRAME_SIZE) & RING_MASK
    }

    /* drain processed samples into output buffer */
    const ready = avail(outW, outR)
    const toRead = Math.min(output.length, ready)
    for (let i = 0; i < toRead; i++) {
      output[i] = outRing[(outR + i) & RING_MASK]
    }
    outR = (outR + toRead) & RING_MASK

    /* fill any underflow tail with silence */
    for (let i = toRead; i < output.length; i++) {
      output[i] = 0
    }
  }

  return {
    node,
    setEnabled(v: boolean) {
      isEnabled = v
      if (v && !denoiseState && !destroyed) {
        void getRnnoise().then(r => {
          if (!destroyed) denoiseState = r.createDenoiseState()
        })
      }
    },
    destroy() {
      destroyed = true
      node.disconnect()
      denoiseState?.destroy()
      denoiseState = null
    },
  }
}
