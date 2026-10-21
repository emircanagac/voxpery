import { useEffect, useState } from 'react'

export const STAGE_TILE_ASPECT = 16 / 9
/** Height of the participant strip under a focused stream (16:9 tiles, 160px wide). */
export const THEATER_STRIP_TILE_HEIGHT = 90

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
 * Picks the column count that gives the largest tiles of the given aspect inside the stage. When
 * even the best fit is smaller than `minTileWidth`, tiles keep that width and the stage scrolls.
 */
export function fitStageGrid(
  count: number,
  box: StageBox,
  minTileWidth: number,
  aspect: number = STAGE_TILE_ASPECT,
): StageGridFit | null {
  const { width, height, gap } = box
  if (count <= 0 || width <= 0 || height <= 0) return null
  let best: StageGridFit | null = null
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns)
    const tileWidth = Math.min(
      (width - gap * (columns - 1)) / columns,
      ((height - gap * (rows - 1)) / rows) * aspect,
    )
    if (tileWidth > 0 && (!best || tileWidth > best.tileWidth)) {
      best = { columns, tileWidth, tileHeight: tileWidth / aspect }
    }
  }
  if (best && best.tileWidth < minTileWidth) {
    const columns = Math.max(1, Math.min(count, Math.floor((width + gap) / (minTileWidth + gap))))
    const tileWidth = (width - gap * (columns - 1)) / columns
    best = { columns, tileWidth, tileHeight: tileWidth / aspect }
  }
  return best && {
    columns: best.columns,
    tileWidth: Math.floor(best.tileWidth),
    tileHeight: Math.floor(best.tileHeight),
  }
}

/**
 * Largest frame with the stream's own aspect that fits inside a tile, so a stream that is not
 * 16:9 (a window or a screen minus its taskbar) is not letterboxed inside a 16:9 frame.
 */
export function fitMediaFrame(aspect: number, width: number, height: number): { width: number; height: number } {
  if (!(aspect > 0) || width <= 0 || height <= 0) return { width: Math.floor(width), height: Math.floor(height) }
  return width / height > aspect
    ? { width: Math.floor(height * aspect), height: Math.floor(height) }
    : { width: Math.floor(width), height: Math.floor(width / aspect) }
}

/**
 * Aspect ratios of the videos inside the stage, keyed by their tile's `data-fullscreen-key`.
 * `loadedmetadata` and `resize` do not bubble, so they are captured on the stage instead of
 * wiring every video element.
 */
export function useStageMediaAspects(element: HTMLElement | null): Record<string, number> {
  const [aspects, setAspects] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!element) return
    const update = (event: Event) => {
      const video = event.target
      if (!(video instanceof HTMLVideoElement) || !video.videoWidth || !video.videoHeight) return
      const key = video.closest<HTMLElement>('[data-fullscreen-key]')?.dataset.fullscreenKey
      if (!key) return
      const aspect = Math.round((video.videoWidth / video.videoHeight) * 1000) / 1000
      setAspects((current) => (current[key] === aspect ? current : { ...current, [key]: aspect }))
    }
    element.addEventListener('loadedmetadata', update, true)
    element.addEventListener('resize', update, true)
    return () => {
      element.removeEventListener('loadedmetadata', update, true)
      element.removeEventListener('resize', update, true)
    }
  }, [element])
  return aspects
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
