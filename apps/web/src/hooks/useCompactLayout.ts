import { useSyncExternalStore } from 'react'
import { COMPACT_LAYOUT_MEDIA_QUERY } from '../layout'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useCompactLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COMPACT_LAYOUT_MEDIA_QUERY).matches, () => false)
}
