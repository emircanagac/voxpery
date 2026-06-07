import { useEffect, useMemo, useState } from 'react'
import { resolveInlineMediaUrl } from '../api'
import { trustedInlineMediaFallbackUrl } from '../inlineMediaSources'

type InlineMediaImageProps = {
  src: string
  alt: string
  className?: string
}

type InlineMediaState = {
  useFallback: boolean
  loadFailed: boolean
}

const inlineMediaStateCache = new Map<string, InlineMediaState>()

export default function InlineMediaImage({ src, alt, className }: InlineMediaImageProps) {
  const [state, setState] = useState<InlineMediaState>(() => (
    inlineMediaStateCache.get(src) ?? { useFallback: false, loadFailed: false }
  ))
  const trustedDirectUrl = useMemo(() => trustedInlineMediaFallbackUrl(src), [src])
  const proxiedUrl = resolveInlineMediaUrl(src) ?? src
  const primaryUrl = trustedDirectUrl ?? proxiedUrl
  const fallbackUrl = trustedDirectUrl && trustedDirectUrl !== primaryUrl ? trustedDirectUrl : null
  const activeUrl = state.useFallback && fallbackUrl ? fallbackUrl : primaryUrl
  const isSticker = className?.includes('sticker') ?? false

  useEffect(() => {
    setState(inlineMediaStateCache.get(src) ?? { useFallback: false, loadFailed: false })
  }, [src])

  if (state.loadFailed) {
    return (
      <span
        className={`${className ?? ''} inline-media-unavailable`.trim()}
        role="img"
        aria-label={`${alt} unavailable`}
      />
    )
  }

  return (
    <img
      src={activeUrl}
      alt={alt}
      className={className}
      draggable={false}
      loading="eager"
      decoding="async"
      width={isSticker ? 120 : 320}
      height={isSticker ? 120 : 180}
      onLoad={() => {
        const nextState = { useFallback: state.useFallback, loadFailed: false }
        inlineMediaStateCache.set(src, nextState)
        setState(nextState)
      }}
      onError={() => {
        if (!state.useFallback && fallbackUrl && activeUrl !== fallbackUrl) {
          const nextState = { useFallback: true, loadFailed: false }
          inlineMediaStateCache.set(src, nextState)
          setState(nextState)
          return
        }
        const nextState = { useFallback: state.useFallback, loadFailed: true }
        inlineMediaStateCache.set(src, nextState)
        setState(nextState)
      }}
    />
  )
}
