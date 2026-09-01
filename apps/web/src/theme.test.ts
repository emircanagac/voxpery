import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  createCustomThemePalette,
  formatHexColorDraft,
  getAccessibleAccentText,
  getContrastRatio,
  getStoredThemePreference,
  initializeTheme,
  normalizeHexColor,
  setThemePreference,
  THEME_ACCENT_STORAGE_KEY,
  THEME_CUSTOM_COLOR_STORAGE_KEY,
  THEME_CUSTOM_MODE_STORAGE_KEY,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
} from './theme'

describe('theme preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-custom-accent')
    document.documentElement.removeAttribute('data-custom-theme')
    document.documentElement.removeAttribute('data-custom-theme-mode')
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#16213e">'
  })

  it('falls back safely when stored values are invalid', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'midnight')
    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, 'javascript:alert(1)')

    expect(getStoredThemePreference()).toEqual({
      theme: DEFAULT_THEME,
      customAccent: null,
      customThemeColor: null,
      customThemeMode: 'dark',
    })
  })

  it('normalizes supported hex colors', () => {
    expect(normalizeHexColor('#AbC')).toBe('#aabbcc')
    expect(normalizeHexColor('#12AF90')).toBe('#12af90')
    expect(normalizeHexColor('12af90')).toBe('#12af90')
    expect(normalizeHexColor(' abc ')).toBe('#aabbcc')
    expect(normalizeHexColor('#1234567')).toBeNull()
    expect(formatHexColorDraft('')).toBe('#')
    expect(formatHexColorDraft('##12AF90')).toBe('#12af90')
  })

  it('persists and applies a safe custom accent independently of the theme', () => {
    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, '#2d8f70')
    const saved = setThemePreference({
      theme: 'dark',
      customAccent: '#2d8f70',
      customThemeColor: null,
      customThemeMode: 'dark',
    })

    expect(saved).toEqual({
      theme: 'dark',
      customAccent: '#2d8f70',
      customThemeColor: null,
      customThemeMode: 'dark',
    })
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBe('#2d8f70')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.customAccent).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--user-accent')).toBe('#2d8f70')
    expect(getContrastRatio(
      document.documentElement.style.getPropertyValue('--user-accent-contrast'),
      '#2d8f70',
    )).toBeGreaterThanOrEqual(4.5)
  })

  it('restores the stored preference during startup without user interaction', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')

    expect(initializeTheme()).toEqual({
      theme: 'light',
      customAccent: null,
      customThemeColor: null,
      customThemeMode: 'light',
    })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('keeps every built-in palette and accent above WCAG AA contrast', () => {
    for (const option of THEME_OPTIONS) {
      expect(getContrastRatio(option.textColor, option.backgroundColor), option.label).toBeGreaterThanOrEqual(4.5)
      expect(getContrastRatio(option.secondaryTextColor, option.backgroundColor), option.label).toBeGreaterThanOrEqual(4.5)
      expect(
        getContrastRatio(getAccessibleAccentText(option.defaultAccent), option.defaultAccent),
        `${option.label} accent`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('persists and restores a generated full theme palette', () => {
    const saved = setThemePreference({
      theme: 'voxpery',
      customAccent: null,
      customThemeColor: '#7b3fc6',
      customThemeMode: 'light',
    })

    expect(saved.customThemeColor).toBe('#7b3fc6')
    expect(localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)).toBe('#7b3fc6')
    expect(localStorage.getItem(THEME_CUSTOM_MODE_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.customTheme).toBe('true')
    expect(document.documentElement.dataset.customThemeMode).toBe('dark')
    expect(document.documentElement.style.getPropertyValue('--user-theme-bg-primary')).toMatch(/^#[0-9a-f]{6}$/)
    expect(document.documentElement.style.getPropertyValue('--user-theme-accent')).toMatch(/^#[0-9a-f]{6}$/)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('maps the legacy rose preference into the visible custom theme flow', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'rose')

    expect(getStoredThemePreference()).toEqual({
      theme: DEFAULT_THEME,
      customAccent: null,
      customThemeColor: '#c9578f',
      customThemeMode: 'dark',
    })
  })

  it('generates readable dark and light palettes for extreme user colors', () => {
    for (const baseColor of ['#000000', '#ffffff', '#ff00aa', '#1463ff']) {
      for (const mode of ['dark', 'light'] as const) {
        const palette = createCustomThemePalette(baseColor, mode)
        const surfaces = [
          palette.backgroundColor,
          palette.secondaryBackgroundColor,
          palette.tertiaryBackgroundColor,
          palette.surfaceColor,
          palette.surfaceHoverColor,
          palette.chatColor,
          palette.inputColor,
          palette.headerColor,
          palette.popoverColor,
          palette.elevatedColor,
          palette.topbarStartColor,
          palette.topbarEndColor,
        ]
        for (const surface of surfaces) {
          expect(getContrastRatio(palette.textColor, surface), `${baseColor} ${mode} text on ${surface}`).toBeGreaterThanOrEqual(4.5)
          expect(getContrastRatio(palette.secondaryTextColor, surface), `${baseColor} ${mode} secondary on ${surface}`).toBeGreaterThanOrEqual(4.5)
          expect(getContrastRatio(palette.mutedTextColor, surface), `${baseColor} ${mode} muted on ${surface}`).toBeGreaterThanOrEqual(4.5)
          expect(getContrastRatio(palette.accentColor, surface), `${baseColor} ${mode} accent on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
        expect(
          getContrastRatio(getAccessibleAccentText(palette.accentColor), palette.accentColor),
          `${baseColor} ${mode} accent`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
