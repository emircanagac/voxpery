/**
 * AudioWorkletProcessor that runs RNNoise ML-based noise suppression.
 *
 * This file executes inside the AudioWorklet scope. It dynamically loads
 * the @shiguredo/rnnoise-wasm module and feeds mic audio through the
 * denoiser in 480-sample frames (10 ms at 48 kHz).
 *
 * A ring-buffer bridges the 128-sample render quanta with the 480-sample
 * frames so no audio is lost or sped up. Adds ~10 ms latency —
 * imperceptible for voice chat.
 */

/* ── AudioWorklet ambient types (not in standard DOM lib) ───────── */

declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void

/* ── imports ─────────────────────────────────────────────────────── */

// The polyfill MUST be imported before rnnoise-wasm so it executes first
import './rnnoise-worklet-polyfill'
import { Rnnoise, type DenoiseState } from '@shiguredo/rnnoise-wasm'

/* ── constants ──────────────────────────────────────────────────── */

const FRAME_SIZE = 480          // RNNoise expects exactly 480 samples
const PCM_SCALE  = 32767.0      // RNNoise works with 16-bit PCM range
const RING_BITS  = 14           // 2^14 = 16 384  (power-of-2 for bitmask)
const RING_SIZE  = 1 << RING_BITS
const RING_MASK  = RING_SIZE - 1

/* ── processor ──────────────────────────────────────────────────── */

class RnnoiseProcessor extends AudioWorkletProcessor {
  private denoiseState: DenoiseState | null = null
  private isEnabled: boolean
  private destroyed = false

  /* ring buffers (zero-alloc in the hot path) */
  private readonly inRing  = new Float32Array(RING_SIZE)
  private readonly outRing = new Float32Array(RING_SIZE)
  private readonly frame   = new Float32Array(FRAME_SIZE)
  private inW = 0
  private inR = 0
  private outW = 0
  private outR = 0
  private preloaded = false

  constructor(options: AudioWorkletNodeOptions) {
    super()

    const opts = options.processorOptions as { enabled?: boolean } | undefined
    this.isEnabled = opts?.enabled ?? true

    /* listen for enable/disable and destroy messages */
    this.port.onmessage = (e: MessageEvent) => {
      const data = e.data as { type: string; enabled?: boolean }
      if (data.type === 'set-enabled') {
        this.isEnabled = data.enabled ?? true
        if (this.isEnabled && !this.denoiseState && !this.destroyed) {
          void this.loadWasm()
        }
      } else if (data.type === 'destroy') {
        this.destroyed = true
        this.denoiseState?.destroy()
        this.denoiseState = null
      }
    }

    /* eagerly load WASM when initially enabled */
    if (this.isEnabled) {
      void this.loadWasm()
    }
  }

  private async loadWasm(): Promise<void> {
    try {
      const rnnoise = await Rnnoise.load()
      if (!this.destroyed) {
        this.denoiseState = rnnoise.createDenoiseState()
        this.port.postMessage({ type: 'ready' })
      }
    } catch (err) {
      console.error('[RnnoiseProcessor] Failed to load WASM:', err)
    }
  }

  private avail(w: number, r: number): number {
    return (w - r + RING_SIZE) & RING_MASK
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _parameters: Record<string, Float32Array>,
  ): boolean {
    if (this.destroyed) return false

    const input  = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (!input || !output) return true

    try {
      /* passthrough when disabled or WASM not yet loaded */
      if (!this.isEnabled || !this.denoiseState) {
        output.set(input)
        return true
      }

      /* first run: pre-fill output ring with 1 frame of silence for latency */
      if (!this.preloaded) {
        this.outW = FRAME_SIZE
        this.preloaded = true
      }

      /* push raw mic samples into input ring */
      for (let i = 0; i < input.length; i++) {
        this.inRing[this.inW] = input[i]
        this.inW = (this.inW + 1) & RING_MASK
      }

      /* process all complete 480-sample frames */
      while (this.avail(this.inW, this.inR) >= FRAME_SIZE) {
        for (let j = 0; j < FRAME_SIZE; j++) {
          this.frame[j] = this.inRing[(this.inR + j) & RING_MASK] * PCM_SCALE
        }
        this.inR = (this.inR + FRAME_SIZE) & RING_MASK

        this.denoiseState.processFrame(this.frame)

        for (let j = 0; j < FRAME_SIZE; j++) {
          this.outRing[(this.outW + j) & RING_MASK] = this.frame[j] / PCM_SCALE
        }
        this.outW = (this.outW + FRAME_SIZE) & RING_MASK
      }

      /* drain processed samples into output buffer */
      const ready = this.avail(this.outW, this.outR)
      const toRead = Math.min(output.length, ready)
      for (let i = 0; i < toRead; i++) {
        output[i] = this.outRing[(this.outR + i) & RING_MASK]
      }
      this.outR = (this.outR + toRead) & RING_MASK

      /* fill any underflow tail with silence */
      for (let i = toRead; i < output.length; i++) {
        output[i] = 0
      }
    } catch (err) {
      console.error('[RnnoiseProcessor] Exception in process loop:', err)
      output.set(input)
    }

    return true
  }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor)
