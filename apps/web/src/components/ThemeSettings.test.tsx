import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_ACCENT_STORAGE_KEY,
  THEME_CUSTOM_COLOR_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '../theme'
import ThemeSettings from './ThemeSettings'

describe('ThemeSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-custom-accent')
    document.documentElement.removeAttribute('data-custom-theme')
    document.documentElement.removeAttribute('data-custom-theme-mode')
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#16213e">'
  })

  it('changes and persists the active theme', () => {
    render(<ThemeSettings />)

    fireEvent.click(screen.getByRole('button', { name: /Dark/ }))

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: /Dark/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Default/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Custom/ })).toBeVisible()
  })

  it('resets every appearance preference to the Voxpery default', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    localStorage.setItem(THEME_ACCENT_STORAGE_KEY, '#2d8f70')
    localStorage.setItem(THEME_CUSTOM_COLOR_STORAGE_KEY, '#7b3fc6')
    render(<ThemeSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset defaults' }))

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('voxpery')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.dataset.theme).toBe('voxpery')
    expect(document.documentElement.dataset.customAccent).toBeUndefined()
    expect(document.documentElement.dataset.customTheme).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Reset defaults' })).toBeDisabled()
  })

  it('builds and persists a readable custom theme from one color', () => {
    render(<ThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    const input = screen.getByRole('textbox', { name: 'Custom theme hex color' })
    const initialCustomColor = localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)

    fireEvent.change(input, { target: { value: '#zzzzzz' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('six-digit hex color')
    expect(localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)).toBe(initialCustomColor)

    fireEvent.change(input, { target: { value: '#7b3fc6' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)).toBe('#7b3fc6')
    expect(document.documentElement.dataset.customTheme).toBe('true')
    expect(document.documentElement.dataset.customThemeMode).toBe('dark')
    expect(screen.queryByText('Background style')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Custom accent hex color' })).not.toBeInTheDocument()
  })
})
