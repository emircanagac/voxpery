import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'
import type { SystemFeatures } from '../api'
import EmailVerificationGate from './EmailVerificationGate'

const authApiMocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  requestEmailVerification: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      getMe: authApiMocks.getMe,
      requestEmailVerification: authApiMocks.requestEmailVerification,
    },
  }
})

const unverifiedUser = {
  id: 'user-1',
  username: 'new_user',
  email: 'new@example.test',
  email_verified: false,
  status: 'online' as const,
}

function setRequired(required: boolean) {
  useFeatureStore.setState({
    features: { email_verification_required: required } as SystemFeatures,
  })
}

function renderGate(path = '/social') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<EmailVerificationGate />}>
          <Route path="/social" element={<div>Protected application</div>} />
          <Route path="/verify-email" element={<div>Verification link</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('EmailVerificationGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ token: 'desktop-token', user: unverifiedUser })
  })

  it('shows the app when the server does not require verification', () => {
    setRequired(false)
    renderGate()
    expect(screen.getByText('Protected application')).toBeInTheDocument()
  })

  it('keeps an unverified account on the verification panel until the address is verified', async () => {
    setRequired(true)
    authApiMocks.getMe.mockResolvedValueOnce(unverifiedUser)
    authApiMocks.getMe.mockResolvedValueOnce({ ...unverifiedUser, email_verified: true })
    renderGate()
    expect(screen.getByRole('heading', { name: 'Verify your email address' })).toBeInTheDocument()
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }))
    expect(authApiMocks.requestEmailVerification).toHaveBeenCalledWith('desktop-token')

    await userEvent.click(screen.getByRole('button', { name: "I've verified it" }))
    expect(await screen.findByText('Your email address is not verified yet.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: "I've verified it" }))
    expect(await screen.findByText('Protected application')).toBeInTheDocument()
  })

  it('lets the verification link through', () => {
    setRequired(true)
    renderGate('/verify-email')
    expect(screen.getByText('Verification link')).toBeInTheDocument()
  })
})
