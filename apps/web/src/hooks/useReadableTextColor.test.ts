import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_CHANGED_EVENT, getContrastRatio } from '../theme'
import { useReadableTextColor } from './useReadableTextColor'

const SURFACE_PROPERTIES = ['--bg-chat', '--bg-surface', '--bg-secondary', '--bg-popover']

function setThemeVariables(theme: string, surface: string, textPrimary: string, textMuted: string) {
  const root = document.documentElement
  root.dataset.theme = theme
  for (const property of SURFACE_PROPERTIES) root.style.setProperty(property, surface)
  root.style.setProperty('--text-primary', textPrimary)
  root.style.setProperty('--text-muted', textMuted)
}

afterEach(() => {
  const root = document.documentElement
  delete root.dataset.theme
  for (const property of [...SURFACE_PROPERTIES, '--text-primary', '--text-muted']) root.style.removeProperty(property)
})

describe('useReadableTextColor', () => {
  it('keeps colors that already read well and darkens pale colors on light surfaces', () => {
    setThemeVariables('light', '#ffffff', '#20242c', '#5a6374')
    const { result } = renderHook(() => useReadableTextColor())

    expect(result.current('#1f4fa8')).toBe('#1f4fa8')
    const adjusted = result.current('#93c5fd')!
    expect(adjusted).not.toBe('#93c5fd')
    expect(getContrastRatio(adjusted, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('recomputes after a theme change and keeps dimmed colors readable', () => {
    setThemeVariables('light', '#ffffff', '#20242c', '#5a6374')
    const { result } = renderHook(() => useReadableTextColor())
    expect(getContrastRatio(result.current('#93c5fd')!, '#ffffff')).toBeGreaterThanOrEqual(4.5)

    act(() => {
      setThemeVariables('dark', '#1b1d22', '#f1f3f5', '#9aa1aa')
      window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT))
    })

    expect(result.current('#93c5fd')).toBe('#93c5fd')
    const dimmed = result.current('#3b1d6e', { dimmed: true })!
    expect(getContrastRatio(dimmed, '#1b1d22')).toBeGreaterThanOrEqual(4.5)
  })

  it('passes through missing or non-hex colors', () => {
    const { result } = renderHook(() => useReadableTextColor())
    expect(result.current(null)).toBeUndefined()
    expect(result.current('rebeccapurple')).toBe('rebeccapurple')
  })
})
