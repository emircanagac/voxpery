import { useCallback, useSyncExternalStore } from 'react'
import { THEME_CHANGED_EVENT, ensureContrastColor, mixHexColors, normalizeHexColor } from '../theme'

// Surfaces that user-chosen text colors (role colors) are drawn on.
const TEXT_SURFACE_PROPERTIES = ['--bg-chat', '--bg-surface', '--bg-secondary', '--bg-popover'] as const

interface ThemeTextContext {
  surfaces: string[]
  textPrimary: string | null
  textMuted: string | null
}

const contextCache = new Map<string, ThemeTextContext>()
const colorCache = new Map<string, string>()

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGED_EVENT, onChange)
  return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange)
}

function getThemeSignature(): string {
  const root = document.documentElement
  return [
    root.dataset.theme ?? '',
    root.dataset.customThemeMode ?? '',
    root.style.getPropertyValue('--user-theme-bg-chat'),
    root.style.getPropertyValue('--user-theme-text-primary'),
  ].join('|')
}

function readThemeTextContext(signature: string): ThemeTextContext {
  const cached = contextCache.get(signature)
  if (cached) return cached
  const styles = getComputedStyle(document.documentElement)
  const read = (property: string) => normalizeHexColor(styles.getPropertyValue(property).trim())
  const context = {
    surfaces: TEXT_SURFACE_PROPERTIES.map(read).filter((value): value is string => value !== null),
    textPrimary: read('--text-primary'),
    textMuted: read('--text-muted'),
  }
  contextCache.set(signature, context)
  return context
}

/**
 * Returns a function that adjusts a user-chosen text color (for example a role color) only as
 * much as needed to stay readable (4.5:1) on the active theme's surfaces. `dimmed` blends the
 * color toward the muted text tone first, for offline members.
 */
export function useReadableTextColor() {
  const signature = useSyncExternalStore(subscribe, getThemeSignature, () => '')
  return useCallback((color: string | null | undefined, options: { dimmed?: boolean } = {}): string | undefined => {
    const normalized = normalizeHexColor(color)
    if (!normalized) return color ?? undefined
    const cacheKey = `${signature}|${normalized}|${options.dimmed ? 1 : 0}`
    const cached = colorCache.get(cacheKey)
    if (cached) return cached
    const context = readThemeTextContext(signature)
    if (!context.textPrimary || context.surfaces.length === 0) return normalized
    const base = options.dimmed && context.textMuted ? mixHexColors(normalized, context.textMuted, 0.5) : normalized
    const readable = ensureContrastColor(base, context.surfaces, context.textPrimary)
    colorCache.set(cacheKey, readable)
    return readable
  }, [signature])
}
