import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '../stores/auth'
import LegalConsentBoundary from './LegalConsentBoundary'

const authApiMocks = vi.hoisted(() => ({
  getLegalConsent: vi.fn(),
  acknowledgeLegalConsent: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      getLegalConsent: authApiMocks.getLegalConsent,
      acknowledgeLegalConsent: authApiMocks.acknowledgeLegalConsent,
    },
  }
})

const requiredStatus = {
  required: true,
  current_terms_version: '2026-08-23',
  current_privacy_notice_version: '2026-08-23',
  current_kvkk_notice_version: '2026-08-23',
}

function renderBoundary() {
  return render(
    <MemoryRouter initialEntries={['/social']}>
      <Routes>
        <Route element={<LegalConsentBoundary />}>
          <Route path="/social" element={<div>Protected application</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('LegalConsentBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      token: 'desktop-token',
      user: {
        id: 'user-1',
        username: 'legal_user',
        email: 'legal@example.test',
        email_verified: true,
        status: 'online',
      },
      loggingOut: false,
    })
  })

  it('blocks the application until every current document is acknowledged', async () => {
    authApiMocks.getLegalConsent.mockResolvedValue(requiredStatus)
    authApiMocks.acknowledgeLegalConsent.mockResolvedValue({
      ...requiredStatus,
      required: false,
    })
    const user = userEvent.setup()
    renderBoundary()

    const heading = await screen.findByRole('heading', { name: /review voxpery's legal documents/i })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument()
    const continueButton = screen.getByRole('button', { name: 'Accept and continue' })
    expect(continueButton).toBeDisabled()

    await user.click(screen.getByLabelText(/I accept the/i))
    await user.click(screen.getByLabelText(/I have read the Privacy Notice/i))
    await user.click(screen.getByLabelText(/I have read the KVKK/i))
    await user.click(continueButton)

    await waitFor(() => expect(authApiMocks.acknowledgeLegalConsent).toHaveBeenCalledWith({
      terms_accepted: true,
      terms_version: '2026-08-23',
      privacy_notice_acknowledged: true,
      privacy_notice_version: '2026-08-23',
      kvkk_notice_acknowledged: true,
      kvkk_notice_version: '2026-08-23',
    }, 'desktop-token'))
    expect(await screen.findByText('Protected application')).toBeInTheDocument()
  })

  it('renders the protected route immediately for a current acknowledgement', async () => {
    authApiMocks.getLegalConsent.mockResolvedValue({ ...requiredStatus, required: false })
    renderBoundary()

    expect(await screen.findByText('Protected application')).toBeInTheDocument()
  })
})
