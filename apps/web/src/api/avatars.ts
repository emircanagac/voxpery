import { getApiBase } from './client'
import { getImageProxyGrant } from './imageProxyGrant'

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function resolveExternalImageUrl(rawUrl: string, proxyPath: '/api/images/avatar' | '/api/images/remote', grant: string | null): string {
  const apiBase = getApiBase()
  const apiOrigin = safeOrigin(apiBase)
  const imageOrigin = safeOrigin(rawUrl)
  const pageOrigin = typeof window === 'undefined' ? null : window.location.origin

  if (imageOrigin && (imageOrigin === apiOrigin || imageOrigin === pageOrigin)) {
    return rawUrl
  }

  const url = `${apiBase}${proxyPath}?url=${encodeURIComponent(rawUrl)}`
  return grant ? `${url}&grant=${encodeURIComponent(grant)}` : url
}

function resolveImageUrl(
  rawUrl: string | null | undefined,
  proxyPath: '/api/images/avatar' | '/api/images/remote',
  grant?: string | null,
): string | null {
  const url = rawUrl?.trim()
  if (!url) return null

  const lower = url.toLowerCase()
  if (lower.startsWith('data:image/') || lower.startsWith('blob:')) return url
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) return url

  return resolveExternalImageUrl(url, proxyPath, grant || getImageProxyGrant())
}

export function resolveAvatarUrl(rawUrl?: string | null): string | null {
  return resolveImageUrl(rawUrl, '/api/images/avatar')
}

/** `grant` overrides the session grant, e.g. the icon grant of an invite preview shown before sign-in. */
export function resolveRemoteImageUrl(rawUrl?: string | null, grant?: string | null): string | null {
  return resolveImageUrl(rawUrl, '/api/images/remote', grant)
}

export const resolveServerIconUrl = resolveRemoteImageUrl
export const resolveInlineMediaUrl = resolveRemoteImageUrl
