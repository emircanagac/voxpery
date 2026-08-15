import type { GifOption } from './emoji'

const GIPHY_API_KEY = (import.meta.env.VITE_GIPHY_API_KEY ?? '').trim()
const GIPHY_PAGE_SIZE = 30

type GiphyRendition = {
  url?: string
  webp?: string
  width?: string
  height?: string
}

type GiphyItem = {
  id?: string
  title?: string
  images?: {
    fixed_width_downsampled?: GiphyRendition
    fixed_width?: GiphyRendition
    downsized_medium?: GiphyRendition
    original?: GiphyRendition
  }
}

type GiphyResponse = {
  data?: GiphyItem[]
  pagination?: {
    total_count?: number
    count?: number
    offset?: number
  }
}

export type GiphyPage = {
  options: GifOption[]
  hasMore: boolean
}

function positiveNumber(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function mapGiphyItem(item: GiphyItem): GifOption | null {
  const images = item.images
  const share = images?.downsized_medium ?? images?.fixed_width ?? images?.original
  const preview = images?.fixed_width_downsampled ?? images?.fixed_width ?? share
  const url = share?.url
  const previewUrl = preview?.webp ?? preview?.url
  if (!item.id || !url || !previewUrl) return null
  return {
    id: `giphy-${item.id}`,
    label: item.title?.trim() || 'GIF',
    url,
    previewUrl,
    width: positiveNumber(share.width),
    height: positiveNumber(share.height),
    keywords: [],
  }
}

export function isGiphyConfigured(): boolean {
  return GIPHY_API_KEY.length > 0
}

export async function fetchGiphyGifs(query: string, offset: number, signal: AbortSignal): Promise<GiphyPage> {
  if (!isGiphyConfigured()) return { options: [], hasMore: false }
  const normalizedQuery = query.trim().slice(0, 50)
  const endpoint = normalizedQuery ? 'search' : 'trending'
  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: String(GIPHY_PAGE_SIZE),
    offset: String(Math.max(0, offset)),
    rating: 'pg-13',
    bundle: 'messaging_non_clips',
  })
  if (normalizedQuery) params.set('q', normalizedQuery)
  const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`GIPHY request failed with ${response.status}`)
  const payload = await response.json() as GiphyResponse
  const options = (payload.data ?? []).map(mapGiphyItem).filter((value): value is GifOption => value !== null)
  const count = payload.pagination?.count ?? options.length
  const currentOffset = payload.pagination?.offset ?? offset
  const total = payload.pagination?.total_count ?? currentOffset + count
  return { options, hasMore: currentOffset + count < total && count > 0 }
}
