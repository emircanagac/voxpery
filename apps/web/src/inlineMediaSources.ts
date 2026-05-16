const TRUSTED_GIPHY_HOST_RE = /^media\d*\.giphy\.com$/i
const TRUSTED_TWEMOJI_HOST = 'cdn.jsdelivr.net'
const TRUSTED_TWEMOJI_PATH_PREFIX = '/gh/twitter/twemoji@'

export function trustedInlineMediaFallbackUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return null
    if (TRUSTED_GIPHY_HOST_RE.test(url.hostname)) return rawUrl
    if (
      url.hostname === TRUSTED_TWEMOJI_HOST &&
      url.pathname.startsWith(TRUSTED_TWEMOJI_PATH_PREFIX)
    ) {
      return rawUrl
    }
    return null
  } catch {
    return null
  }
}
