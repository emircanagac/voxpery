import { getApiBase } from './client'

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function resolveExternalImageUrl(rawUrl: string, proxyPath: '/api/images/avatar' | '/api/images/remote'): string {
  const apiBase = getApiBase()
  const apiOrigin = safeOrigin(apiBase)
  const imageOrigin = safeOrigin(rawUrl)
  const pageOrigin = typeof window === 'undefined' ? null : window.location.origin

  if (imageOrigin && (imageOrigin === apiOrigin || imageOrigin === pageOrigin)) {
    return rawUrl
  }

  return `${apiBase}${proxyPath}?url=${encodeURIComponent(rawUrl)}`
}

function resolveImageUrl(rawUrl: string | null | undefined, proxyPath: '/api/images/avatar' | '/api/images/remote'): string | null {
  const url = rawUrl?.trim()
  if (!url) return null

  const lower = url.toLowerCase()
  if (lower.startsWith('data:image/') || lower.startsWith('blob:')) return url
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return url

  return resolveExternalImageUrl(url, proxyPath)
}

export function resolveAvatarUrl(rawUrl?: string | null): string | null {
  return resolveImageUrl(rawUrl, '/api/images/avatar')
}

export function resolveRemoteImageUrl(rawUrl?: string | null): string | null {
  return resolveImageUrl(rawUrl, '/api/images/remote')
}

export const resolveServerIconUrl = resolveRemoteImageUrl
export const resolveInlineMediaUrl = resolveRemoteImageUrl
