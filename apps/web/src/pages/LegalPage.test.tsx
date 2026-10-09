import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import LegalPage from './LegalPage'

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><LegalPage /></MemoryRouter>)
}

afterEach(() => { document.title = '' })

describe('hosted legal pages', () => {
  it.each([
    ['/terms', 'Terms of Service', 'Terms', 'en'],
    ['/privacy', 'Privacy Notice', 'Privacy', 'en'],
    ['/kvkk', 'KVKK Aydınlatma Metni', 'KVKK', 'tr'],
  ])('renders %s with its own title, current tab and language', (path, heading, tab, lang) => {
    renderAt(path)
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(document.title).toBe(`${heading} | Voxpery`)
    expect(screen.getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('article')).toHaveAttribute('lang', lang)
    const tabs = screen.getByRole('navigation', { name: 'Legal documents' })
    expect(tabs.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  })

  it('links the Terms to the Privacy Notice', () => {
    renderAt('/terms')
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy')
  })
})
