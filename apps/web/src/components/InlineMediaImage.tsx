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
  const fallbackUrl = useMemo(() => trustedInlineMediaFallbackUrl(src), [src])
  const primaryUrl = resolveInlineMediaUrl(src) ?? src
  const activeUrl = useFallback && fallbackUrl ? fallbackUrl : primaryUrl

  useEffect(() => {
    setUseFallback(false)
  }, [src])

  return (
    <img
      src={activeUrl}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => {
        if (!useFallback && fallbackUrl && activeUrl !== fallbackUrl) {
          setUseFallback(true)
        }
      }}
    />
  )
}
