import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  cleanup()
  useAuthStore.setState({ token: null, user: null, loggingOut: false })
  vi.mocked(releaseApi.getLatest).mockReset()
})

describe('AboutPage', () => {
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
    expect(screen.getByText(/a discord alternative for communities/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: /use voxpery in browser/i })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery',
    )
    expect(screen.getByRole('link', { name: 'Releases' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/releases/latest',
    )
    expect(screen.getByRole('link', { name: 'Contributors' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/graphs/contributors',
    )
    expect(screen.getByRole('link', { name: 'Security' })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/blob/main/SECURITY.md',
    )
    expect(screen.getByText(/create an account and start chatting right away/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /self-host with docker/i })).toHaveAttribute(
      'href',
      'https://github.com/emircanagac/voxpery/blob/main/docs/DEPLOYMENT.md',
    )
    expect(screen.getByText('Inspectable by design')).toBeInTheDocument()
    expect(screen.getByText('Your deployment choice')).toBeInTheDocument()
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
