export const THEME_STORAGE_KEY = 'voxpery-settings-theme'
export const THEME_ACCENT_STORAGE_KEY = 'voxpery-settings-theme-accent'
export const THEME_CHANGED_EVENT = 'voxpery-theme-changed'

export type ThemeId = 'voxpery' | 'dark' | 'rose' | 'light'

export interface ThemeOption {
  id: ThemeId
  label: string
  description: string
  colorScheme: 'dark' | 'light'
  chromeColor: string
  backgroundColor: string
  surfaceColor: string
  textColor: string
  secondaryTextColor: string
  defaultAccent: string
}

export interface ThemePreference {
  theme: ThemeId
  customAccent: string | null
}

export const DEFAULT_THEME: ThemeId = 'voxpery'

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: 'voxpery',
    label: 'Voxpery Blue',
    description: 'The original deep-blue Voxpery palette.',
    colorScheme: 'dark',
    chromeColor: '#16213e',
    backgroundColor: '#1a1a2e',
    surfaceColor: '#1e2746',
    textColor: '#e8e8f0',
    secondaryTextColor: '#a0a0b8',
    defaultAccent: '#4f7fd8',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'A neutral charcoal palette with reduced blue tint.',
    colorScheme: 'dark',
    chromeColor: '#17191f',
    backgroundColor: '#181a1f',
    surfaceColor: '#23262d',
    textColor: '#f1f3f5',
    secondaryTextColor: '#b5bac1',
    defaultAccent: '#6078d4',
  },
  {
    id: 'rose',
    label: 'Rose',
    description: 'A dark berry palette with a warm pink accent.',
    colorScheme: 'dark',
    chromeColor: '#2a1a29',
    backgroundColor: '#211820',
    surfaceColor: '#30222f',
    textColor: '#f6edf3',
    secondaryTextColor: '#cbb2c2',
    defaultAccent: '#c9578f',
  },
  {
    id: 'light',
    label: 'Light',
    description: 'A high-contrast light palette for bright environments.',
    colorScheme: 'light',
    chromeColor: '#ffffff',
    backgroundColor: '#f4f6f8',
    surfaceColor: '#ffffff',
    textColor: '#20242c',
    secondaryTextColor: '#4e5867',
    defaultAccent: '#315fbd',
  },
] as const

const THEME_IDS = new Set<ThemeId>(THEME_OPTIONS.map((option) => option.id))
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.has(value as ThemeId)
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (HEX_COLOR_PATTERN.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex) ?? '#000000'
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function getContrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function getAccessibleAccentText(accent: string): '#101217' | '#ffffff' {
  return getContrastRatio(accent, '#101217') >= getContrastRatio(accent, '#ffffff')
    ? '#101217'
    : '#ffffff'
}

export function getThemeOption(theme: ThemeId): ThemeOption {
  return THEME_OPTIONS.find((option) => option.id === theme) ?? THEME_OPTIONS[0]
}

export function getStoredThemePreference(storage: Pick<Storage, 'getItem'> = localStorage): ThemePreference {
  try {
    const storedTheme = storage.getItem(THEME_STORAGE_KEY)
    const storedAccent = normalizeHexColor(storage.getItem(THEME_ACCENT_STORAGE_KEY))
    return {
      theme: isThemeId(storedTheme) ? storedTheme : DEFAULT_THEME,
      customAccent: storedAccent,
    }
  } catch {
    return { theme: DEFAULT_THEME, customAccent: null }
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  documentTarget: Document = document,
): ThemePreference {
  const theme = isThemeId(preference.theme) ? preference.theme : DEFAULT_THEME
  const customAccent = normalizeHexColor(preference.customAccent)
  const option = getThemeOption(theme)
  const root = documentTarget.documentElement

  root.dataset.theme = theme
  root.style.colorScheme = option.colorScheme

  if (customAccent) {
    root.dataset.customAccent = 'true'
    root.style.setProperty('--user-accent', customAccent)
    root.style.setProperty('--user-accent-contrast', getAccessibleAccentText(customAccent))
  } else {
    delete root.dataset.customAccent
    root.style.removeProperty('--user-accent')
    root.style.removeProperty('--user-accent-contrast')
  }

  const themeColor = documentTarget.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColor?.setAttribute('content', option.chromeColor)

  return { theme, customAccent }
}

export function setThemePreference(preference: ThemePreference): ThemePreference {
  const normalized = applyThemePreference(preference)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, normalized.theme)
    if (normalized.customAccent) {
      localStorage.setItem(THEME_ACCENT_STORAGE_KEY, normalized.customAccent)
    } else {
      localStorage.removeItem(THEME_ACCENT_STORAGE_KEY)
    }
  } catch {
    // Applying the in-memory preference still keeps the current session usable.
  }
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_CHANGED_EVENT, { detail: normalized }))
  return normalized
}

export function initializeTheme(): ThemePreference {
  return applyThemePreference(getStoredThemePreference())
}
