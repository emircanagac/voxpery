import { describe, expect, it, vi } from 'vitest'
import {
  connectSilentVoicePipelineKeepAlive,
  shouldUseLightweightMobileVoicePipeline,
} from './useAudioEngine'

describe('mobile voice pipeline selection', () => {
  it('uses the lightweight native-processing path on mobile runtimes', () => {
    expect(shouldUseLightweightMobileVoicePipeline({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile',
      maxTouchPoints: 5,
    })).toBe(true)
    expect(shouldUseLightweightMobileVoicePipeline({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      maxTouchPoints: 5,
    })).toBe(true)
  })

  it('keeps the full processing pipeline on desktop runtimes', () => {
    expect(shouldUseLightweightMobileVoicePipeline({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 0,
    })).toBe(false)
  })
})

describe('processed microphone pipeline keep-alive', () => {
  it('keeps the shared graph rendering without playing the microphone locally', () => {
    const destination = {} as AudioDestinationNode
    const gain = {
      gain: { value: 1 },
      connect: vi.fn(),
    } as unknown as GainNode
    const ctx = {
      destination,
      createGain: vi.fn(() => gain),
    } as unknown as AudioContext
    const source = { connect: vi.fn() } as unknown as AudioNode

    expect(connectSilentVoicePipelineKeepAlive(ctx, source)).toBe(gain)
    expect(gain.gain.value).toBe(0)
    expect(source.connect).toHaveBeenCalledWith(gain)
    expect(gain.connect).toHaveBeenCalledWith(destination)
  })
})
