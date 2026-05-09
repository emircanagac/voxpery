import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import LoginPage from './LoginPage'
import RegisterPage from './RegisterPage'
import ForgotPasswordPage from './ForgotPasswordPage'
import ResetPasswordPage from './ResetPasswordPage'
import { useFeatureStore } from '../stores/features'
import type { SystemFeatures } from '../api'

const disabledFeatures: SystemFeatures = {
  google_oauth_enabled: false,
  email_delivery_enabled: false,
  email_verification_enabled: false,
  email_verification_required: false,
  password_reset_enabled: false,
}

function renderWithFeatures(ui: ReactElement, features: SystemFeatures = disabledFeatures) {
  useFeatureStore.setState({ features, loading: false, error: null })
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

afterEach(() => {
  useFeatureStore.setState({ features: null, loading: false, error: null })
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
})
