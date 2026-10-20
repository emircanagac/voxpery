import { describe, expect, it } from 'vitest'
import { fitStageGrid } from './voiceStageLayout'

describe('fitStageGrid', () => {
  it('keeps two tiles at 16:9 instead of stretching them to the stage height', () => {
    expect(fitStageGrid(2, { width: 1400, height: 692, gap: 12 }, 180)).toEqual({ columns: 2, tileWidth: 694, tileHeight: 390 })
    expect(fitStageGrid(2, { width: 850, height: 692, gap: 12 }, 180)?.columns).toBe(1)
  })

  it('stacks tiles on a portrait phone stage', () => {
    expect(fitStageGrid(2, { width: 343, height: 600, gap: 8 }, 140)).toEqual({ columns: 1, tileWidth: 343, tileHeight: 192 })
  })

  it('fits a single focused stream to the largest 16:9 box', () => {
    expect(fitStageGrid(1, { width: 1200, height: 600, gap: 12 }, 180)).toEqual({ columns: 1, tileWidth: 1066, tileHeight: 600 })
    expect(fitStageGrid(1, { width: 800, height: 900, gap: 12 }, 180)).toEqual({ columns: 1, tileWidth: 800, tileHeight: 450 })
  })

  it('chooses the grid with the largest tiles', () => {
    expect(fitStageGrid(4, { width: 1200, height: 700, gap: 12 }, 180)?.columns).toBe(2)
    expect(fitStageGrid(6, { width: 1600, height: 700, gap: 12 }, 180)?.columns).toBe(3)
  })

  it('scrolls instead of shrinking tiles below the minimum width', () => {
    expect(fitStageGrid(12, { width: 400, height: 300, gap: 8 }, 140)).toEqual({ columns: 2, tileWidth: 196, tileHeight: 110 })
  })

  it('returns no layout before the stage is measured', () => {
    expect(fitStageGrid(3, { width: 0, height: 0, gap: 12 }, 180)).toBeNull()
    expect(fitStageGrid(0, { width: 800, height: 600, gap: 12 }, 180)).toBeNull()
  })
})
