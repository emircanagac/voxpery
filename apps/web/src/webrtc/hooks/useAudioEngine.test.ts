import { describe, expect, it } from 'vitest'
import { shouldUseLightweightMobileVoicePipeline } from './useAudioEngine'

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
