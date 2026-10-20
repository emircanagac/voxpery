import { useEffect, useState } from 'react'

export const STAGE_TILE_ASPECT = 16 / 9

export interface StageBox {
  width: number
  height: number
  gap: number
}

export interface StageGridFit {
  columns: number
  tileWidth: number
  tileHeight: number
}

/**
 * Picks the column count that gives the largest 16:9 tiles inside the stage. When even the best
 * fit is smaller than `minTileWidth`, tiles keep that width and the stage scrolls instead.
 */
export function fitStageGrid(count: number, box: StageBox, minTileWidth: number): StageGridFit | null {
  const { width, height, gap } = box
  if (count <= 0 || width <= 0 || height <= 0) return null
  let best: StageGridFit | null = null
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns)
    const tileWidth = Math.min(
      (width - gap * (columns - 1)) / columns,
      ((height - gap * (rows - 1)) / rows) * STAGE_TILE_ASPECT,
    )
    if (tileWidth > 0 && (!best || tileWidth > best.tileWidth)) {
      best = { columns, tileWidth, tileHeight: tileWidth / STAGE_TILE_ASPECT }
    }
  }
  if (best && best.tileWidth < minTileWidth) {
    const columns = Math.max(1, Math.min(count, Math.floor((width + gap) / (minTileWidth + gap))))
    const tileWidth = (width - gap * (columns - 1)) / columns
    best = { columns, tileWidth, tileHeight: tileWidth / STAGE_TILE_ASPECT }
  }
  return best && {
    columns: best.columns,
    tileWidth: Math.floor(best.tileWidth),
    tileHeight: Math.floor(best.tileHeight),
  }
}

/** Content-box size and grid gap of the voice stage, tracked while it is mounted. */
export function useStageBox(element: HTMLElement | null): StageBox | null {
  const [box, setBox] = useState<StageBox | null>(null)
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') {
      setBox(null)
      return
    }
    const measure = () => {
      const style = getComputedStyle(element)
      const px = (value: string) => parseFloat(value) || 0
      const width = element.clientWidth - px(style.paddingLeft) - px(style.paddingRight)
      const height = element.clientHeight - px(style.paddingTop) - px(style.paddingBottom)
      const gap = px(style.columnGap)
      setBox((current) => (
        current && current.width === width && current.height === height && current.gap === gap
          ? current
          : { width, height, gap }
      ))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return box
}
