import { getApiBase } from './client'

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function resolveAvatarUrl(rawUrl?: string | null): string | null {
  const url = rawUrl?.trim()
  if (!url) return null

  const lower = url.toLowerCase()
  if (lower.startsWith('data:image/') || lower.startsWith('blob:')) return url
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return url

  const apiBase = getApiBase()
  const apiOrigin = safeOrigin(apiBase)
  const avatarOrigin = safeOrigin(url)
  const pageOrigin = typeof window === 'undefined' ? null : window.location.origin

  if (avatarOrigin && (avatarOrigin === apiOrigin || avatarOrigin === pageOrigin)) {
    return url
  }

  return `${apiBase}/api/images/avatar?url=${encodeURIComponent(url)}`
}
