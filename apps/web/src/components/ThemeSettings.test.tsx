import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_ACCENT_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '../theme'
import ThemeSettings from './ThemeSettings'

describe('ThemeSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-custom-accent')
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = '<meta name="theme-color" content="#16213e">'
  })

  it('changes and persists the active theme', () => {
    render(<ThemeSettings />)

    fireEvent.click(screen.getByRole('button', { name: /Rose/ }))

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('rose')
    expect(document.documentElement.dataset.theme).toBe('rose')
    expect(screen.getByRole('button', { name: /Rose/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('validates, applies, and resets a custom accent', () => {
    render(<ThemeSettings />)
    const input = screen.getByRole('textbox', { name: 'Custom accent hex color' })

    fireEvent.change(input, { target: { value: '#12' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('six-digit hex color')
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBeNull()

    fireEvent.change(input, { target: { value: '#2d8f70' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBe('#2d8f70')
    expect(document.documentElement.dataset.customAccent).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Use theme accent' }))
    expect(localStorage.getItem(THEME_ACCENT_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.dataset.customAccent).toBeUndefined()
  })
})
