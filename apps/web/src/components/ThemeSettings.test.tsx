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
    expect(screen.getByRole('button', { name: /^DefaultThe original/ })).toBeVisible()
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
    expect(screen.getByRole('alert')).toHaveTextContent('numbers 0-9 and letters A-F')
    expect(localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)).toBe(initialCustomColor)

    fireEvent.change(input, { target: { value: '#7b3fc6' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)).toBe('#7b3fc6')
    expect(document.documentElement.dataset.customTheme).toBe('true')
    expect(document.documentElement.dataset.customThemeMode).toBe('dark')
    expect(screen.queryByText('Background style')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Custom accent hex color' })).toBeVisible()
  })

  it('keeps the hex prefix and normalizes pasted colors', () => {
    render(<ThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    const themeInput = screen.getByRole('textbox', { name: 'Custom theme hex color' })

    fireEvent.change(themeInput, { target: { value: '' } })
    expect(themeInput).toHaveValue('#')
    fireEvent.blur(themeInput)
    expect(screen.getByRole('alert')).toHaveTextContent('six hex digits after #')

    fireEvent.paste(themeInput, {
      clipboardData: { getData: () => '7B3FC6' },
    })
    expect(themeInput).toHaveValue('#7b3fc6')
    expect(localStorage.getItem(THEME_CUSTOM_COLOR_STORAGE_KEY)).toBe('#7b3fc6')

    const accentInput = screen.getByRole('textbox', { name: 'Custom accent hex color' })
    fireEvent.paste(accentInput, {
      clipboardData: { getData: () => '#2F9B78' },
    })
    expect(accentInput).toHaveValue('#2f9b78')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBe('#2f9b78')
  })

  it('explains incomplete and overlong hex values without replacing the saved color', () => {
    render(<ThemeSettings />)
    const accentInput = screen.getByRole('textbox', { name: 'Custom accent hex color' })

    fireEvent.change(accentInput, { target: { value: '12ab' } })
    expect(accentInput).toHaveValue('#12ab')
    fireEvent.blur(accentInput)
    expect(screen.getByRole('alert')).toHaveTextContent('need six digits')

    fireEvent.change(accentInput, { target: { value: '#1234567' } })
    fireEvent.blur(accentInput)
    expect(screen.getByRole('alert')).toHaveTextContent('exactly six digits')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBeNull()
  })

  it('changes and resets the accent without replacing the selected theme', () => {
    render(<ThemeSettings />)
    fireEvent.click(screen.getByRole('button', { name: /Dark/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Emerald accent' }))

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBe('#2f9b78')
    expect(document.documentElement.dataset.customAccent).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Reset accent color' }))

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.dataset.customAccent).toBeUndefined()
  })
})
