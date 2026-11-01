import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authApi } from '../api'
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

describe('legal pages on a self-hosted server', () => {
  const selfHosted = (urls = {}) => vi.spyOn(authApi, 'getLegalDocuments').mockResolvedValue({
    required: false,
    current_terms_version: 'own-1',
    current_privacy_notice_version: 'own-1',
    current_kvkk_notice_version: 'own-1',
    operator: 'self_hosted',
    ...urls,
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('replaces the hosted text and links the operator document', async () => {
    selfHosted({ privacy_url: 'https://chat.example.org/privacy' })
    renderAt('/privacy')
    expect(await screen.findByText(/run independently of voxpery\.com/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: "Read this server's Privacy Notice" }))
      .toHaveAttribute('href', 'https://chat.example.org/privacy')
    expect(screen.queryByText(/Emircan Agac/)).not.toBeInTheDocument()
  })

  it('ignores a document address that is not a web address', async () => {
    selfHosted({ privacy_url: 'javascript:alert(1)' })
    renderAt('/privacy')
    expect(await screen.findByText(/has not published this document/)).toBeInTheDocument()
  })

  it('treats a desktop app on a custom server as self-hosted even if the server does not say so', () => {
    vi.spyOn(authApi, 'getLegalDocuments').mockRejectedValue(new Error('offline'))
    window.__VOXPERY_DESKTOP_SERVER__ = { apiBase: 'https://chat.example.org' }
    try {
      renderAt('/privacy')
      expect(screen.getByText(/run independently of voxpery\.com/)).toBeInTheDocument()
    } finally {
      delete window.__VOXPERY_DESKTOP_SERVER__
    }
  })

  it('says so when the operator published nothing', async () => {
    selfHosted()
    renderAt('/kvkk')
    expect(await screen.findByText(/has not published this document/)).toBeInTheDocument()
    expect(screen.queryByText(/Emircan Agac/)).not.toBeInTheDocument()
  })
})
