import { describe, expect, it } from 'vitest'
import { resizeStreamPreview, STREAM_PREVIEW_MAX_WIDTH, streamPreviewFrame, streamPreviewPosition } from './streamPreviewLayout'

describe('stream preview geometry', () => {
  const bounds = { left: 322, top: 108, width: 1290, height: 780 }

  it.each([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }])('keeps all four corners inside the central content: %o', (position) => {
    const frame = streamPreviewFrame(bounds, 360, position)
    expect(frame.left).toBeGreaterThanOrEqual(bounds.left)
    expect(frame.top).toBeGreaterThanOrEqual(bounds.top)
    expect(frame.left + frame.width).toBeLessThanOrEqual(bounds.left + bounds.width)
    expect(frame.top + frame.height).toBeLessThanOrEqual(bounds.top + bounds.height)
    expect(streamPreviewPosition(bounds, frame.width, frame.left, frame.top)).toEqual(position)
  })

  it('clamps drags beyond the central content', () => {
    expect(streamPreviewPosition(bounds, 360, -1000, -1000)).toEqual({ x: 0, y: 0 })
    expect(streamPreviewPosition(bounds, 360, 9000, 9000)).toEqual({ x: 1, y: 1 })
  })

  it('preserves a bottom-right anchor when enlarged', () => {
    for (const width of [240, 437, STREAM_PREVIEW_MAX_WIDTH]) {
      const frame = streamPreviewFrame(bounds, width, { x: 1, y: 1 })
      expect(frame.left + frame.width).toBe(bounds.left + bounds.width)
      expect(frame.top + frame.height).toBe(bounds.top + bounds.height)
    }
  })

  it.each([{ left: 76, top: 100, width: 220, height: 500 }, { left: 76, top: 100, width: 640, height: 100 }])('fits narrow or short viewports without changing the aspect ratio', (compact) => {
    const frame = streamPreviewFrame(compact, 720, { x: 1, y: 1 })
    expect(frame.width).toBeLessThanOrEqual(compact.width)
    expect(frame.height).toBeLessThanOrEqual(compact.height)
    expect(frame.width / frame.height).toBeCloseTo(16 / 9)
  })

  it('handles an unavailable content area without invalid coordinates', () => {
    const empty = { left: 10, top: 20, width: 0, height: 0 }
    expect(streamPreviewFrame(empty, 360, { x: 1, y: 0 })).toEqual({ left: 10, top: 20, width: 0, height: 0 })
    expect(streamPreviewPosition(empty, 0, 10, 20)).toEqual({ x: 1, y: 0 })
  })

  it.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const)('resizes freely from %s while preserving the opposite corner and aspect ratio', corner => {
    const original = { left: 600, top: 400, width: 360, height: 202.5 }
    const west = corner.endsWith('left')
    const north = corner.startsWith('top')
    for (const delta of [77, -60, 9999, -9999]) {
      const resized = resizeStreamPreview(bounds, original, corner, delta * (west ? -1 : 1), delta * 9 / 16 * (north ? -1 : 1))
      const frame = streamPreviewFrame(bounds, resized.width, resized.position)
      expect(frame.left + (west ? frame.width : 0)).toBeCloseTo(original.left + (west ? original.width : 0))
      expect(frame.top + (north ? frame.height : 0)).toBeCloseTo(original.top + (north ? original.height : 0))
      expect(frame.width).toBeGreaterThanOrEqual(240)
      expect(frame.width).toBeLessThanOrEqual(STREAM_PREVIEW_MAX_WIDTH)
      expect(frame.width / frame.height).toBeCloseTo(16 / 9)
      expect(frame.left).toBeGreaterThanOrEqual(bounds.left - 0.01)
      expect(frame.top).toBeGreaterThanOrEqual(bounds.top - 0.01)
      if (delta === 77) expect(frame.width).toBe(437)
    }
  })

  it('allows larger bottom-left resizing up to 960px without exceeding content', () => {
    const original = streamPreviewFrame(bounds, 360, { x: 1, y: 0 })
    const resized = resizeStreamPreview(bounds, original, 'bottom-left', -1000, 0)
    expect(resized.width).toBe(960)
    const frame = streamPreviewFrame(bounds, resized.width, resized.position)
    expect(frame.left + frame.width).toBe(original.left + original.width)
    expect(frame.top).toBe(original.top)
    expect(frame.height).toBeLessThanOrEqual(bounds.height)
  })

  it.each([1, 16 / 10, 9 / 16, 21 / 9])('preserves native ratio %s and all opposite-corner anchors within bounds', ratio => {
    const original = streamPreviewFrame(bounds, 360, { x: 0.5, y: 0.5 }, ratio)
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const west = corner.endsWith('left')
      const north = corner.startsWith('top')
      const resized = resizeStreamPreview(bounds, original, corner, west ? -70 : 70, north ? -40 : 40, ratio)
      const frame = streamPreviewFrame(bounds, resized.width, resized.position, ratio)
      expect(frame.width / frame.height).toBeCloseTo(ratio)
      expect(frame.left + (west ? frame.width : 0)).toBeCloseTo(original.left + (west ? original.width : 0))
      expect(frame.top + (north ? frame.height : 0)).toBeCloseTo(original.top + (north ? original.height : 0))
      expect(frame.left + frame.width).toBeLessThanOrEqual(bounds.left + bounds.width + 0.01)
      expect(frame.top + frame.height).toBeLessThanOrEqual(bounds.top + bounds.height + 0.01)
      expect(streamPreviewPosition(bounds, frame.width, frame.left, frame.top, ratio)).toEqual(resized.position)
    }
  })
})
