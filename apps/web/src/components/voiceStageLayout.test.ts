import { describe, expect, it } from 'vitest'
import { fitMediaFrame, fitStageGrid, stripVisibleCount } from './voiceStageLayout'

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

  it('fits a focused stream at its own aspect when one is given', () => {
    // A screen minus a 48px taskbar (1920x1032) fills the frame instead of being letterboxed.
    expect(fitStageGrid(1, { width: 1340, height: 707, gap: 12 }, 180, 1920 / 1032)).toEqual({ columns: 1, tileWidth: 1315, tileHeight: 707 })
    expect(fitStageGrid(1, { width: 800, height: 900, gap: 12 }, 180, 4 / 3)).toEqual({ columns: 1, tileWidth: 800, tileHeight: 600 })
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

describe('fitMediaFrame', () => {
  it('shrinks a stream inside its 16:9 cell to the stream aspect', () => {
    expect(fitMediaFrame(1920 / 1032, 661, 371)).toEqual({ width: 661, height: 355 })
    expect(fitMediaFrame(4 / 3, 640, 360)).toEqual({ width: 480, height: 360 })
    expect(fitMediaFrame(16 / 9, 640, 360)).toEqual({ width: 640, height: 360 })
  })

  it('keeps the cell size when the stream aspect is unknown', () => {
    expect(fitMediaFrame(0, 640, 360)).toEqual({ width: 640, height: 360 })
    expect(fitMediaFrame(Number.NaN, 640, 360)).toEqual({ width: 640, height: 360 })
  })
})

describe('stripVisibleCount', () => {
  it('shows every strip tile that fits and keeps one slot for "+N" otherwise', () => {
    // 804px holds four 160px tiles with 12px gaps.
    expect(stripVisibleCount(3, 804, 160, 12)).toBe(3)
    expect(stripVisibleCount(4, 804, 160, 12)).toBe(4)
    expect(stripVisibleCount(5, 804, 160, 12)).toBe(3)
    expect(stripVisibleCount(30, 804, 160, 12)).toBe(3)
    // Too narrow for even one tile: only the "+N" tile is shown.
    expect(stripVisibleCount(3, 100, 160, 12)).toBe(0)
    expect(stripVisibleCount(0, 804, 160, 12)).toBe(0)
  })
})
