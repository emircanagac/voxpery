import { useEffect, useMemo, useState } from 'react'
import { resolveInlineMediaUrl } from '../api'
import { trustedInlineMediaFallbackUrl } from '../inlineMediaSources'

type InlineMediaImageProps = {
  src: string
  alt: string
  className?: string
}

export default function InlineMediaImage({ src, alt, className }: InlineMediaImageProps) {
  const [useFallback, setUseFallback] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const trustedDirectUrl = useMemo(() => trustedInlineMediaFallbackUrl(src), [src])
  const proxiedUrl = resolveInlineMediaUrl(src) ?? src
  const primaryUrl = trustedDirectUrl ?? proxiedUrl
  const fallbackUrl = trustedDirectUrl && trustedDirectUrl !== primaryUrl ? trustedDirectUrl : null
  const activeUrl = useFallback && fallbackUrl ? fallbackUrl : primaryUrl

  useEffect(() => {
    setUseFallback(false)
    setLoadFailed(false)
  }, [src])

  if (loadFailed) {
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
      loading="lazy"
      onError={() => {
        if (!useFallback && fallbackUrl && activeUrl !== fallbackUrl) {
          setUseFallback(true)
          return
        }
        setLoadFailed(true)
      }}
    />
  )
}
