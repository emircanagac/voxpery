import { describe, expect, it } from 'vitest'
import { trustedInlineMediaFallbackUrl } from './inlineMediaSources'

describe('trustedInlineMediaFallbackUrl', () => {
  it('allows built-in Giphy media as a direct preview fallback', () => {
    const url = 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif'

    expect(trustedInlineMediaFallbackUrl(url)).toBe(url)
  })

  it('allows built-in Twemoji stickers as a direct preview fallback', () => {
    const url = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f389.png'

    expect(trustedInlineMediaFallbackUrl(url)).toBe(url)
  })

  it('rejects untrusted or non-https media fallbacks', () => {
    expect(trustedInlineMediaFallbackUrl('http://media.giphy.com/media/example/giphy.gif')).toBeNull()
    expect(trustedInlineMediaFallbackUrl('https://example.giphy.com/media/example/giphy.gif')).toBeNull()
    expect(trustedInlineMediaFallbackUrl('https://example.com/media.gif')).toBeNull()
  })
})
