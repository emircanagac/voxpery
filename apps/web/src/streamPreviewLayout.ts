export type PreviewBounds = { left: number; top: number; width: number; height: number }
export type PreviewPosition = { x: number; y: number }
export type PreviewCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const STREAM_PREVIEW_MAX_WIDTH = 960

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value))

export function streamPreviewFrame(bounds: PreviewBounds, requestedWidth: number, position: PreviewPosition, aspectRatio = 16 / 9) {
  const width = Math.max(0, Math.min(requestedWidth, STREAM_PREVIEW_MAX_WIDTH, bounds.width, bounds.height * aspectRatio))
  const height = width / aspectRatio
  return {
    width,
    height,
    left: bounds.left + clamp(position.x, 1) * Math.max(0, bounds.width - width),
    top: bounds.top + clamp(position.y, 1) * Math.max(0, bounds.height - height),
  }
}

export function resizeStreamPreview(bounds: PreviewBounds, frame: { left: number; top: number; width: number; height: number }, corner: PreviewCorner, dx: number, dy: number, aspectRatio = 16 / 9) {
  const west = corner.endsWith('left')
  const north = corner.startsWith('top')
  const anchorX = frame.left + (west ? frame.width : 0)
  const anchorY = frame.top + (north ? frame.height : 0)
  const horizontal = dx * (west ? -1 : 1)
  const vertical = dy * (north ? -1 : 1) * aspectRatio
  const delta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical
  const available = Math.max(0, Math.min(
    STREAM_PREVIEW_MAX_WIDTH,
    west ? anchorX - bounds.left : bounds.left + bounds.width - anchorX,
    (north ? anchorY - bounds.top : bounds.top + bounds.height - anchorY) * aspectRatio,
  ))
  const width = Math.max(Math.min(240, available), Math.min(available, frame.width + delta))
  const left = anchorX - (west ? width : 0)
  const top = anchorY - (north ? width / aspectRatio : 0)
  return { width, position: streamPreviewPosition(bounds, width, left, top, aspectRatio) }
}

export function streamPreviewPosition(bounds: PreviewBounds, width: number, left: number, top: number, aspectRatio = 16 / 9): PreviewPosition {
  const travelX = Math.max(0, bounds.width - width)
  const travelY = Math.max(0, bounds.height - width / aspectRatio)
  return {
    x: travelX ? clamp(left - bounds.left, travelX) / travelX : 1,
    y: travelY ? clamp(top - bounds.top, travelY) / travelY : 0,
  }
}
