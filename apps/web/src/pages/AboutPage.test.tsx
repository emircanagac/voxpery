import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { releaseApi } from '../api'
import { useAuthStore } from '../stores/auth'
import AboutPage from './AboutPage'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    releaseApi: {
      getLatest: vi.fn(),
    },
  }
})

beforeEach(() => {
  vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }))
})

afterEach(() => {
  cleanup()
  useAuthStore.setState({ token: null, user: null, loggingOut: false })
  vi.mocked(releaseApi.getLatest).mockReset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AboutPage', () => {
  it('renders browser-only entry points in the compact layout', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: true, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }))
    vi.mocked(releaseApi.getLatest).mockRejectedValue(new Error('release unavailable'))
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Use Voxpery in browser' })).toHaveAttribute('href', '/register')
    expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Releases' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Self-host with Docker' })).not.toBeInTheDocument()
  })

  it('does not offer Android visitors a Linux desktop installer', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5 })
    vi.mocked(releaseApi.getLatest).mockResolvedValue({ tag: 'v0.3.0', html_url: 'https://github.com/emircanagac/voxpery/releases/tag/v0.3.0', downloads: { linux: 'https://example.com/desktop.AppImage' } })
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    await waitFor(() => expect(releaseApi.getLatest).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('link', { name: 'Download for Linux' })).not.toBeInTheDocument()
  })

  it('presents the hosted and self-hosted paths to new visitors', async () => {
    vi.mocked(releaseApi.getLatest).mockResolvedValue({
      tag: 'v0.2.3',
      html_url: 'https://github.com/emircanagac/voxpery/releases/tag/v0.2.3',
      published_at: '2026-06-28T12:00:00Z',
      downloads: {},
    })

    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Voxpery', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voxpery' }).querySelector('img')).toHaveAttribute('src', '/fox-animated.svg')
    expect(screen.getByText(/text chat, voice channels, screen sharing, and moderation/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: /use voxpery in browser/i })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery',
    )
    expect(screen.getByRole('link', { name: 'Compare' })).toHaveAttribute('href', '/compare')
    expect(screen.getByRole('link', { name: 'Releases' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/releases/latest',
    )
    expect(screen.getByRole('link', { name: 'Contribute' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/blob/main/docs/CONTRIBUTING.md',
    )
    expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/blob/main/SECURITY.md',
    )
    expect(screen.getByRole('link', { name: /self-host with docker/i })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/blob/main/docs/DEPLOYMENT.md',
    )
    expect(screen.getByRole('img', { name: 'Voxpery voice channel interface' })).toHaveAttribute('width', '1918')
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy')
    expect(screen.getByRole('link', { name: 'KVKK Notice' })).toHaveAttribute('href', '/kvkk')
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
    expect(await screen.findByText(/Latest release: v0\.2\.3/)).toBeInTheDocument()
  })

  it('routes authenticated visitors back into the app', async () => {
    vi.mocked(releaseApi.getLatest).mockRejectedValue(new Error('release unavailable'))
    useAuthStore.setState({
      token: 'test-token',
      user: {
        id: 'user-1',
        username: 'tester',
        email: 'tester@example.com',
        email_verified: true,
        status: 'online',
      },
      loggingOut: false,
    })

    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Go to app' })).toHaveAttribute('href', '/social')
    expect(screen.getByRole('link', { name: /open voxpery/i })).toHaveAttribute('href', '/social')
    expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
    await waitFor(() => expect(releaseApi.getLatest).toHaveBeenCalledTimes(1))
  })
})
