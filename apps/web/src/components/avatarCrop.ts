export const AVATAR_CROP_PREVIEW_SIZE = 240
export const AVATAR_CROP_OUTPUT_SIZE = 512
export const AVATAR_CROP_MAX_DATA_URL_LENGTH = 1_000_000

export type AvatarCropOffset = { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function getAvatarCropGeometry(
  width: number,
  height: number,
  zoom: number,
  offset: AvatarCropOffset,
  previewSize = AVATAR_CROP_PREVIEW_SIZE,
) {
  if (width <= 0 || height <= 0 || previewSize <= 0) throw new Error('Invalid profile photo dimensions')
  const scale = Math.max(previewSize / width, previewSize / height) * clamp(zoom, 1, 3)
  const displayWidth = width * scale
  const displayHeight = height * scale
  const limitX = (displayWidth - previewSize) / 2
  const limitY = (displayHeight - previewSize) / 2
  const x = clamp(offset.x, -limitX, limitX)
  const y = clamp(offset.y, -limitY, limitY)
  const left = (previewSize - displayWidth) / 2 + x
  const top = (previewSize - displayHeight) / 2 + y

  return {
    displayWidth,
    displayHeight,
    left,
    top,
    offset: { x, y },
    sourceX: Math.max(0, -left / scale),
    sourceY: Math.max(0, -top / scale),
    sourceSize: previewSize / scale,
  }
}

export function renderAvatarCrop(
  image: HTMLImageElement,
  zoom: number,
  offset: AvatarCropOffset,
  previewSize = AVATAR_CROP_PREVIEW_SIZE,
) {
  const crop = getAvatarCropGeometry(image.naturalWidth, image.naturalHeight, zoom, offset, previewSize)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_CROP_OUTPUT_SIZE
  canvas.height = AVATAR_CROP_OUTPUT_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Photo editing is unavailable in this browser')
  context.drawImage(image, crop.sourceX, crop.sourceY, crop.sourceSize, crop.sourceSize,
    0, 0, AVATAR_CROP_OUTPUT_SIZE, AVATAR_CROP_OUTPUT_SIZE)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
  if (!dataUrl.startsWith('data:image/jpeg;base64,') || dataUrl.length > AVATAR_CROP_MAX_DATA_URL_LENGTH) {
    throw new Error('Edited photo is too large to save')
  }
  return dataUrl
}
