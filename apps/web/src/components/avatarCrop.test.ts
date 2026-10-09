import { describe, expect, it } from 'vitest'
import { getAvatarCropGeometry } from './avatarCrop'

describe('avatar crop geometry', () => {
  it('centers a landscape image into a square without changing its aspect ratio', () => {
    const crop = getAvatarCropGeometry(1200, 600, 1, { x: 0, y: 0 })
    expect(crop.displayWidth).toBe(480)
    expect(crop.displayHeight).toBe(240)
    expect(crop.sourceX).toBe(300)
    expect(crop.sourceY).toBe(0)
    expect(crop.sourceSize).toBe(600)
  })

  it('clamps drag offsets to the image edges after zooming', () => {
    const crop = getAvatarCropGeometry(600, 1200, 2, { x: 1000, y: -1000 })
    expect(crop.offset).toEqual({ x: 120, y: -360 })
    expect(crop.sourceX).toBe(0)
    expect(crop.sourceY).toBe(900)
    expect(crop.sourceSize).toBe(300)
  })

  it('keeps a square image centered and supports a responsive preview size', () => {
    const crop = getAvatarCropGeometry(500, 500, 1, { x: 10, y: 10 }, 200)
    expect(crop.offset).toEqual({ x: 0, y: 0 })
    expect(crop.sourceSize).toBe(500)
  })
})
