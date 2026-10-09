import { describe, expect, it } from 'vitest'
import { AVATAR_CROP_MAX_DATA_URL_LENGTH, encodeAvatarCanvas, getAvatarCropGeometry } from './avatarCrop'

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

describe('avatar encoding', () => {
  const canvas = (outputs: Record<string, string>) => ({
    toDataURL: (type?: string) => outputs[type ?? 'image/png'] ?? outputs['image/png'],
  })
  const small = (type: string) => `data:${type};base64,AAAA`
  const huge = (type: string) => `data:${type};base64,${'A'.repeat(AVATAR_CROP_MAX_DATA_URL_LENGTH)}`

  it('keeps transparency for PNG sources as WebP without flattening', () => {
    let flattened = false
    const result = encodeAvatarCanvas(canvas({ 'image/webp': small('image/webp') }), 'image/png', () => { flattened = true })
    expect(result).toBe(small('image/webp'))
    expect(flattened).toBe(false)
  })

  it('falls back to PNG when the browser cannot encode WebP', () => {
    // Browsers without a WebP encoder return PNG for unsupported types.
    const result = encodeAvatarCanvas(canvas({ 'image/png': small('image/png') }), 'image/gif', () => {})
    expect(result).toBe(small('image/png'))
  })

  it('flattens onto white only when lossless formats exceed the size limit', () => {
    let flattened = false
    const result = encodeAvatarCanvas(canvas({
      'image/webp': huge('image/webp'), 'image/png': huge('image/png'), 'image/jpeg': small('image/jpeg'),
    }), 'image/webp', () => { flattened = true })
    expect(result).toBe(small('image/jpeg'))
    expect(flattened).toBe(true)
  })

  it('saves JPEG sources as JPEG and rejects oversized output', () => {
    expect(encodeAvatarCanvas(canvas({ 'image/jpeg': small('image/jpeg') }), 'image/jpeg', () => {})).toBe(small('image/jpeg'))
    expect(() => encodeAvatarCanvas(canvas({ 'image/jpeg': huge('image/jpeg') }), 'image/jpeg', () => {})).toThrow('too large')
  })
})
