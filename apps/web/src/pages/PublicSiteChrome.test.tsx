import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PublicSiteHeader } from './PublicSiteChrome'

describe('public navigation', () => {
  it('exposes menu state, dismisses on Escape/outside click and closes after navigation', () => {
    render(<MemoryRouter><PublicSiteHeader page="about" /></MemoryRouter>)
    const toggle = screen.getByRole('button', { name: 'Open navigation' })
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(toggle).toHaveAttribute('aria-controls', nav.id)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(nav).toHaveClass('about-topbar-nav--open')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle).toHaveFocus()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    fireEvent.pointerDown(document.body)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('link', { name: 'Compare' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})
