import type { GifOption, StickerOption } from './emoji'

const RECENT_EMOJI_KEY = 'voxpery-expression-recent-emoji-v1'
const RECENT_GIF_KEY = 'voxpery-expression-recent-gif-v1'
const RECENT_STICKER_KEY = 'voxpery-expression-recent-sticker-v1'
const FAVORITE_GIF_KEY = 'voxpery-expression-favorite-gif-v1'
const FAVORITE_STICKER_KEY = 'voxpery-expression-favorite-sticker-v1'

const MAX_RECENT_EMOJI = 24
const MAX_RECENT_MEDIA = 16
const MAX_FAVORITE_GIFS = 50
const MAX_FAVORITE_STICKERS = 50

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readArray<T>(key: string): T[] {
  if (!storageAvailable()) return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeArray<T>(key: string, values: T[]): void {
  if (!storageAvailable()) return
  try {
    window.localStorage.setItem(key, JSON.stringify(values))
  } catch {
    // Expression history is a best-effort device preference.
  }
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeGif(value: unknown): GifOption | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<GifOption>
  if (typeof item.id !== 'string' || typeof item.label !== 'string' || !isHttpsUrl(item.url)) return null
  return {
    id: item.id.slice(0, 160),
    label: item.label.slice(0, 160),
    url: item.url,
    previewUrl: isHttpsUrl(item.previewUrl) ? item.previewUrl : undefined,
    width: Number.isFinite(item.width) ? Math.max(1, Number(item.width)) : undefined,
    height: Number.isFinite(item.height) ? Math.max(1, Number(item.height)) : undefined,
    keywords: Array.isArray(item.keywords)
      ? item.keywords.filter((entry): entry is string => typeof entry === 'string').slice(0, 12)
      : [],
  }
}

function normalizeSticker(value: unknown): StickerOption | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<StickerOption>
  if (typeof item.id !== 'string' || typeof item.label !== 'string' || !isHttpsUrl(item.imageUrl)) return null
  return {
    id: item.id.slice(0, 160),
    label: item.label.slice(0, 160),
    imageUrl: item.imageUrl,
    previewUrl: isHttpsUrl(item.previewUrl) ? item.previewUrl : undefined,
    keywords: Array.isArray(item.keywords)
      ? item.keywords.filter((entry): entry is string => typeof entry === 'string').slice(0, 12)
      : [],
  }
}

function putFirst<T>(values: T[], item: T, identity: (value: T) => string, limit: number): T[] {
  const key = identity(item)
  return [item, ...values.filter((value) => identity(value) !== key)].slice(0, limit)
}

export function getRecentEmojis(): string[] {
  return readArray<unknown>(RECENT_EMOJI_KEY)
    .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32)
    .slice(0, MAX_RECENT_EMOJI)
}

export function recordRecentEmoji(emoji: string): string[] {
  const next = putFirst(getRecentEmojis(), emoji, (value) => value, MAX_RECENT_EMOJI)
  writeArray(RECENT_EMOJI_KEY, next)
  return next
}

export function getRecentGifs(): GifOption[] {
  return readArray<unknown>(RECENT_GIF_KEY).map(normalizeGif).filter((value): value is GifOption => value !== null).slice(0, MAX_RECENT_MEDIA)
}

export function recordRecentGif(gif: GifOption): GifOption[] {
  const normalized = normalizeGif(gif)
  if (!normalized) return getRecentGifs()
  const next = putFirst(getRecentGifs(), normalized, (value) => value.url, MAX_RECENT_MEDIA)
  writeArray(RECENT_GIF_KEY, next)
  return next
}

export function getRecentStickers(): StickerOption[] {
  return readArray<unknown>(RECENT_STICKER_KEY).map(normalizeSticker).filter((value): value is StickerOption => value !== null).slice(0, MAX_RECENT_MEDIA)
}

export function recordRecentSticker(sticker: StickerOption): StickerOption[] {
  const normalized = normalizeSticker(sticker)
  if (!normalized) return getRecentStickers()
  const next = putFirst(getRecentStickers(), normalized, (value) => value.imageUrl, MAX_RECENT_MEDIA)
  writeArray(RECENT_STICKER_KEY, next)
  return next
}

export function getFavoriteGifs(): GifOption[] {
  return readArray<unknown>(FAVORITE_GIF_KEY).map(normalizeGif).filter((value): value is GifOption => value !== null).slice(0, MAX_FAVORITE_GIFS)
}

export function toggleFavoriteGif(gif: GifOption): GifOption[] {
  const normalized = normalizeGif(gif)
  if (!normalized) return getFavoriteGifs()
  const current = getFavoriteGifs()
  const exists = current.some((value) => value.url === normalized.url)
  const next = exists
    ? current.filter((value) => value.url !== normalized.url)
    : putFirst(current, normalized, (value) => value.url, MAX_FAVORITE_GIFS)
  writeArray(FAVORITE_GIF_KEY, next)
  return next
}

export function getFavoriteStickers(): StickerOption[] {
  return readArray<unknown>(FAVORITE_STICKER_KEY)
    .map(normalizeSticker)
    .filter((value): value is StickerOption => value !== null)
    .slice(0, MAX_FAVORITE_STICKERS)
}

export function toggleFavoriteSticker(sticker: StickerOption): StickerOption[] {
  const normalized = normalizeSticker(sticker)
  if (!normalized) return getFavoriteStickers()
  const current = getFavoriteStickers()
  const exists = current.some((value) => value.imageUrl === normalized.imageUrl)
  const next = exists
    ? current.filter((value) => value.imageUrl !== normalized.imageUrl)
    : putFirst(current, normalized, (value) => value.imageUrl, MAX_FAVORITE_STICKERS)
  writeArray(FAVORITE_STICKER_KEY, next)
  return next
}
