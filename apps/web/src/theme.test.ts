import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  getAccessibleAccentText,
  getContrastRatio,
  getStoredThemePreference,
  initializeTheme,
  normalizeHexColor,
  setThemePreference,
  THEME_ACCENT_STORAGE_KEY,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
} from './theme'

describe('theme preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-custom-accent')
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#16213e">'
  })

  it('falls back safely when stored values are invalid', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'midnight')
    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, 'javascript:alert(1)')

    expect(getStoredThemePreference()).toEqual({
      theme: DEFAULT_THEME,
      customAccent: null,
    })
  })

  it('normalizes supported hex colors', () => {
    expect(normalizeHexColor('#AbC')).toBe('#aabbcc')
    expect(normalizeHexColor('#12AF90')).toBe('#12af90')
    expect(normalizeHexColor('12af90')).toBeNull()
  })

  it('persists and applies the selected theme and custom accent', () => {
    const saved = setThemePreference({ theme: 'rose', customAccent: '#2d8f70' })

    expect(saved).toEqual({ theme: 'rose', customAccent: '#2d8f70' })
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('rose')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBe('#2d8f70')
    expect(document.documentElement.dataset.theme).toBe('rose')
    expect(document.documentElement.dataset.customAccent).toBe('true')
    expect(document.documentElement.style.getPropertyValue('--user-accent')).toBe('#2d8f70')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#2a1a29')
  })

  it('restores the stored preference during startup without user interaction', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')

    expect(initializeTheme()).toEqual({ theme: 'light', customAccent: null })
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
})
