import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactElement } from 'react'
import LoginPage from './LoginPage'
import RegisterPage from './RegisterPage'
import ForgotPasswordPage from './ForgotPasswordPage'
import ResetPasswordPage from './ResetPasswordPage'
import { useFeatureStore } from '../stores/features'
import type { SystemFeatures } from '../api'
import { openExternalUrl } from '../openExternalUrl'

vi.mock('../openExternalUrl', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}))
const disabledFeatures: SystemFeatures = {
  google_oauth_enabled: false,
  observability_enabled: false,
  email_delivery_enabled: false,
  email_verification_enabled: false,
  email_verification_required: false,
  password_reset_enabled: false,
}

const enabledGoogleFeatures: SystemFeatures = {
  ...disabledFeatures,
  google_oauth_enabled: true,
  observability_enabled: false,
}

function renderWithFeatures(ui: ReactElement, features: SystemFeatures = disabledFeatures) {
  useFeatureStore.setState({ features, loading: false, error: null })
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

afterEach(() => {
  useFeatureStore.setState({ features: null, loading: false, error: null })
  window.localStorage.clear()
  delete (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__
  vi.mocked(openExternalUrl).mockClear()
})

describe('auth feature gating', () => {
  it('hides Google and password reset actions on login when integrations are disabled', () => {
    renderWithFeatures(<LoginPage />)

    expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument()
    expect(screen.queryByText('Forgot password?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('hides Google sign-up on register when Google OAuth is disabled', () => {
    renderWithFeatures(<RegisterPage />)

    expect(screen.queryByText('Continue with Google')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument()
  })

  it('does not expose a PKCE-less desktop Google OAuth URL on login', async () => {
    ;(window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {}
    renderWithFeatures(<LoginPage />, enabledGoogleFeatures)

    const googleLink = screen.getByRole('link', { name: /continue with google/i })
    expect(googleLink).toHaveAttribute('href', '#')

    fireEvent.click(googleLink)

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledTimes(1)
    })
    const openedUrl = vi.mocked(openExternalUrl).mock.calls[0]?.[0] ?? ''
    expect(openedUrl).toContain('/api/auth/google?')
    expect(openedUrl).toContain('origin=voxpery%3A%2F%2Fauth')
    expect(openedUrl).toContain('code_challenge=')
  })

  it('does not expose a PKCE-less desktop Google OAuth URL on register', async () => {
    ;(window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {}
    renderWithFeatures(<RegisterPage />, enabledGoogleFeatures)

    const googleLink = screen.getByRole('link', { name: /continue with google/i })
    expect(googleLink).toHaveAttribute('href', '#')

    fireEvent.click(googleLink)

    await waitFor(() => {
      expect(openExternalUrl).toHaveBeenCalledTimes(1)
    })
    const openedUrl = vi.mocked(openExternalUrl).mock.calls[0]?.[0] ?? ''
    expect(openedUrl).toContain('/api/auth/google?')
    expect(openedUrl).toContain('origin=voxpery%3A%2F%2Fauth')
    expect(openedUrl).toContain('code_challenge=')
  })

  it('shows a disabled password reset message instead of the request form', () => {
    renderWithFeatures(<ForgotPasswordPage />)

    expect(
      screen.getByText('Password reset is not available because this server has not configured email delivery.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send Reset Link' })).not.toBeInTheDocument()
  })

  it('shows a disabled password reset message instead of the reset form', () => {
    renderWithFeatures(<ResetPasswordPage />)

    expect(
      screen.getByText('Password reset is not available because this server has not configured email delivery.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset Password' })).not.toBeInTheDocument()
  })

  it('does not silently remove auth integrations when feature discovery fails', () => {
    useFeatureStore.setState({
      features: null,
      loading: false,
      error: 'feature endpoint unavailable',
    })

    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Additional sign-in options could not be loaded.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('waits for feature discovery before declaring password recovery disabled', () => {
    useFeatureStore.setState({ features: null, loading: true, error: null })

    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)

    expect(screen.getByText('Checking password recovery availability...')).toBeInTheDocument()
    expect(
      screen.queryByText('Password reset is not available because this server has not configured email delivery.'),
    ).not.toBeInTheDocument()
  })
})
