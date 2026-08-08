export const THEME_STORAGE_KEY = 'voxpery-settings-theme'
export const THEME_ACCENT_STORAGE_KEY = 'voxpery-settings-theme-accent'
export const THEME_CUSTOM_COLOR_STORAGE_KEY = 'voxpery-settings-theme-custom-color'
export const THEME_CUSTOM_MODE_STORAGE_KEY = 'voxpery-settings-theme-custom-mode'
export const THEME_CHANGED_EVENT = 'voxpery-theme-changed'

export type ThemeId = 'voxpery' | 'dark' | 'rose' | 'light'
export type ThemeColorScheme = 'dark' | 'light'

export interface ThemeOption {
  id: ThemeId
  label: string
  description: string
  colorScheme: ThemeColorScheme
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
  customThemeColor: string | null
  customThemeMode: ThemeColorScheme
}

export interface CustomThemePalette {
  colorScheme: ThemeColorScheme
  baseColor: string
  chromeColor: string
  backgroundColor: string
  secondaryBackgroundColor: string
  tertiaryBackgroundColor: string
  surfaceColor: string
  surfaceHoverColor: string
  chatColor: string
  inputColor: string
  headerColor: string
  popoverColor: string
  elevatedColor: string
  topbarStartColor: string
  topbarEndColor: string
  textColor: string
  secondaryTextColor: string
  mutedTextColor: string
  accentColor: string
  accentHoverColor: string
  scrollbarColor: string
  scrollbarHoverColor: string
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
const CUSTOM_THEME_STYLE_PROPERTIES = [
  '--user-theme-bg-primary',
  '--user-theme-bg-secondary',
  '--user-theme-bg-tertiary',
  '--user-theme-bg-surface',
  '--user-theme-bg-surface-hover',
  '--user-theme-bg-chat',
  '--user-theme-bg-input',
  '--user-theme-bg-header',
  '--user-theme-bg-popover',
  '--user-theme-bg-elevated',
  '--user-theme-topbar-start',
  '--user-theme-topbar-end',
  '--user-theme-text-primary',
  '--user-theme-text-secondary',
  '--user-theme-text-muted',
  '--user-theme-accent',
  '--user-theme-accent-hover',
  '--user-theme-accent-contrast',
  '--user-theme-scrollbar',
  '--user-theme-scrollbar-hover',
] as const

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

function rgbToHex([red, green, blue]: [number, number, number]): string {
  const toHex = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function mixHexColors(first: string, second: string, firstWeight: number): string {
  const firstRgb = hexToRgb(first)
  const secondRgb = hexToRgb(second)
  const weight = Math.min(1, Math.max(0, firstWeight))
  return rgbToHex([
    firstRgb[0] * weight + secondRgb[0] * (1 - weight),
    firstRgb[1] * weight + secondRgb[1] * (1 - weight),
    firstRgb[2] * weight + secondRgb[2] * (1 - weight),
  ])
}

function ensureContrastColor(
  color: string,
  surfaces: readonly string[],
  contrastTarget: string,
  minimumRatio = 4.5,
): string {
  for (let step = 0; step <= 20; step += 1) {
    const colorWeight = 1 - step / 20
    const candidate = mixHexColors(color, contrastTarget, colorWeight)
    if (surfaces.every((surface) => getContrastRatio(candidate, surface) >= minimumRatio)) {
      return candidate
    }
  }
  return contrastTarget
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

export function createCustomThemePalette(baseColor: string, colorScheme: ThemeColorScheme): CustomThemePalette {
  const normalized = normalizeHexColor(baseColor) ?? getThemeOption(DEFAULT_THEME).defaultAccent
  if (colorScheme === 'light') {
    const backgroundColor = mixHexColors(normalized, '#f5f7fa', 0.045)
    const secondaryBackgroundColor = mixHexColors(normalized, '#e8ebf0', 0.075)
    const tertiaryBackgroundColor = mixHexColors(normalized, '#dce2eb', 0.12)
    const surfaceColor = mixHexColors(normalized, '#ffffff', 0.025)
    const surfaceHoverColor = mixHexColors(normalized, '#edf0f4', 0.095)
    const chatColor = mixHexColors(normalized, '#f8f9fb', 0.035)
    const inputColor = mixHexColors(normalized, '#ffffff', 0.02)
    const headerColor = mixHexColors(normalized, '#ffffff', 0.03)
    const popoverColor = mixHexColors(normalized, '#ffffff', 0.045)
    const elevatedColor = mixHexColors(normalized, '#f1f3f6', 0.08)
    const topbarStartColor = mixHexColors(normalized, '#ffffff', 0.05)
    const topbarEndColor = mixHexColors(normalized, '#f4f6f8', 0.055)
    const accent = ensureContrastColor(normalized, [
      backgroundColor,
      secondaryBackgroundColor,
      tertiaryBackgroundColor,
      surfaceColor,
      surfaceHoverColor,
      chatColor,
      inputColor,
      headerColor,
      popoverColor,
      elevatedColor,
      topbarStartColor,
      topbarEndColor,
    ], '#111827')
    return {
      colorScheme,
      baseColor: normalized,
      chromeColor: mixHexColors(normalized, '#ffffff', 0.035),
      backgroundColor,
      secondaryBackgroundColor,
      tertiaryBackgroundColor,
      surfaceColor,
      surfaceHoverColor,
      chatColor,
      inputColor,
      headerColor,
      popoverColor,
      elevatedColor,
      topbarStartColor,
      topbarEndColor,
      textColor: '#20242c',
      secondaryTextColor: '#3f4855',
      mutedTextColor: '#46505f',
      accentColor: accent,
      accentHoverColor: mixHexColors(accent, '#000000', 0.82),
      scrollbarColor: mixHexColors(accent, '#ffffff', 0.42),
      scrollbarHoverColor: mixHexColors(accent, '#ffffff', 0.64),
    }
  }

  const backgroundColor = mixHexColors(normalized, '#15171d', 0.08)
  const secondaryBackgroundColor = mixHexColors(normalized, '#151820', 0.12)
  const tertiaryBackgroundColor = mixHexColors(normalized, '#252b36', 0.18)
  const surfaceColor = mixHexColors(normalized, '#20232b', 0.13)
  const surfaceHoverColor = mixHexColors(normalized, '#292d36', 0.17)
  const chatColor = mixHexColors(normalized, '#17191f', 0.08)
  const inputColor = mixHexColors(normalized, '#0f1116', 0.05)
  const headerColor = mixHexColors(normalized, '#1b1e25', 0.12)
  const popoverColor = mixHexColors(normalized, '#1d2028', 0.15)
  const elevatedColor = mixHexColors(normalized, '#242832', 0.18)
  const topbarStartColor = mixHexColors(normalized, '#20232b', 0.14)
  const topbarEndColor = mixHexColors(normalized, '#171a20', 0.11)
  const accent = ensureContrastColor(normalized, [
    backgroundColor,
    secondaryBackgroundColor,
    tertiaryBackgroundColor,
    surfaceColor,
    surfaceHoverColor,
    chatColor,
    inputColor,
    headerColor,
    popoverColor,
    elevatedColor,
    topbarStartColor,
    topbarEndColor,
  ], '#ffffff')
  return {
    colorScheme,
    baseColor: normalized,
    chromeColor: mixHexColors(normalized, '#12141a', 0.13),
    backgroundColor,
    secondaryBackgroundColor,
    tertiaryBackgroundColor,
    surfaceColor,
    surfaceHoverColor,
    chatColor,
    inputColor,
    headerColor,
    popoverColor,
    elevatedColor,
    topbarStartColor,
    topbarEndColor,
    textColor: '#f3f4f6',
    secondaryTextColor: '#dde0e5',
    mutedTextColor: '#c3c8cf',
    accentColor: accent,
    accentHoverColor: mixHexColors(accent, '#ffffff', 0.82),
    scrollbarColor: mixHexColors(accent, '#15171d', 0.44),
    scrollbarHoverColor: mixHexColors(accent, '#ffffff', 0.62),
  }
}

export function getStoredThemePreference(storage: Pick<Storage, 'getItem'> = localStorage): ThemePreference {
  try {
    const storedTheme = storage.getItem(THEME_STORAGE_KEY)
    const storedCustomThemeColor = normalizeHexColor(storage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY))
    const isLegacyRoseTheme = storedTheme === 'rose'
    const theme = isLegacyRoseTheme
      ? DEFAULT_THEME
      : isThemeId(storedTheme) ? storedTheme : DEFAULT_THEME
    const customThemeColor = storedCustomThemeColor
      ?? (isLegacyRoseTheme ? getThemeOption('rose').defaultAccent : null)
    return {
      theme,
      customAccent: null,
      customThemeColor,
      customThemeMode: customThemeColor ? 'dark' : getThemeOption(theme).colorScheme,
    }
  } catch {
    return {
      theme: DEFAULT_THEME,
      customAccent: null,
      customThemeColor: null,
      customThemeMode: getThemeOption(DEFAULT_THEME).colorScheme,
    }
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  documentTarget: Document = document,
): ThemePreference {
  const theme = isThemeId(preference.theme) ? preference.theme : DEFAULT_THEME
  const customAccent = null
  const customThemeColor = normalizeHexColor(preference.customThemeColor)
  const option = getThemeOption(theme)
  const customThemeMode = customThemeColor ? 'dark' : option.colorScheme
  const customThemePalette = customThemeColor
    ? createCustomThemePalette(customThemeColor, customThemeMode)
    : null
  const root = documentTarget.documentElement

  root.dataset.theme = theme
  root.style.colorScheme = customThemeColor ? customThemeMode : option.colorScheme

  if (customThemePalette) {
    const palette = customThemePalette
    root.dataset.customTheme = 'true'
    root.dataset.customThemeMode = customThemeMode
    root.style.setProperty('--user-theme-bg-primary', palette.backgroundColor)
    root.style.setProperty('--user-theme-bg-secondary', palette.secondaryBackgroundColor)
    root.style.setProperty('--user-theme-bg-tertiary', palette.tertiaryBackgroundColor)
    root.style.setProperty('--user-theme-bg-surface', palette.surfaceColor)
    root.style.setProperty('--user-theme-bg-surface-hover', palette.surfaceHoverColor)
    root.style.setProperty('--user-theme-bg-chat', palette.chatColor)
    root.style.setProperty('--user-theme-bg-input', palette.inputColor)
    root.style.setProperty('--user-theme-bg-header', palette.headerColor)
    root.style.setProperty('--user-theme-bg-popover', palette.popoverColor)
    root.style.setProperty('--user-theme-bg-elevated', palette.elevatedColor)
    root.style.setProperty('--user-theme-topbar-start', palette.topbarStartColor)
    root.style.setProperty('--user-theme-topbar-end', palette.topbarEndColor)
    root.style.setProperty('--user-theme-text-primary', palette.textColor)
    root.style.setProperty('--user-theme-text-secondary', palette.secondaryTextColor)
    root.style.setProperty('--user-theme-text-muted', palette.mutedTextColor)
    root.style.setProperty('--user-theme-accent', palette.accentColor)
    root.style.setProperty('--user-theme-accent-hover', palette.accentHoverColor)
    root.style.setProperty('--user-theme-accent-contrast', getAccessibleAccentText(palette.accentColor))
    root.style.setProperty('--user-theme-scrollbar', palette.scrollbarColor)
    root.style.setProperty('--user-theme-scrollbar-hover', palette.scrollbarHoverColor)
  } else {
    delete root.dataset.customTheme
    delete root.dataset.customThemeMode
    for (const property of CUSTOM_THEME_STYLE_PROPERTIES) root.style.removeProperty(property)
  }

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
  const activeChromeColor = customThemePalette?.chromeColor ?? option.chromeColor
  themeColor?.setAttribute('content', activeChromeColor)

  return { theme, customAccent, customThemeColor, customThemeMode }
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
    if (normalized.customThemeColor) {
      localStorage.setItem(THEME_CUSTOM_COLOR_STORAGE_KEY, normalized.customThemeColor)
    } else {
      localStorage.removeItem(THEME_CUSTOM_COLOR_STORAGE_KEY)
    }
    localStorage.setItem(THEME_CUSTOM_MODE_STORAGE_KEY, normalized.customThemeMode)
  } catch {
    // Applying the in-memory preference still keeps the current session usable.
  }
  window.dispatchEvent(new CustomEvent<ThemePreference>(THEME_CHANGED_EVENT, { detail: normalized }))
  return normalized
}

export function initializeTheme(): ThemePreference {
  return applyThemePreference(getStoredThemePreference())
}
