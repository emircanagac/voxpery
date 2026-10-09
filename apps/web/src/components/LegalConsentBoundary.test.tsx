import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuthStore } from '../stores/auth'
import LegalConsentBoundary from './LegalConsentBoundary'
import { LEGAL_CONSENT_REQUIRED_EVENT } from '../api'

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
      legalConsent: null,
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

  it('uses the server session snapshot without another document request, including remounts', () => {
    useAuthStore.setState({ legalConsent: { ...requiredStatus, required: false } })
    const view = renderBoundary()
    expect(screen.getByText('Protected application')).toBeInTheDocument()
    expect(authApiMocks.getLegalConsent).not.toHaveBeenCalled()
    view.unmount()
    renderBoundary()
    expect(screen.getByText('Protected application')).toBeInTheDocument()
    expect(authApiMocks.getLegalConsent).not.toHaveBeenCalled()
  })

  it('still refreshes a session snapshot when the server requires new documents', async () => {
    useAuthStore.setState({ legalConsent: { ...requiredStatus, required: false } })
    authApiMocks.getLegalConsent.mockResolvedValue({ ...requiredStatus, current_terms_version: 'new-version' })
    renderBoundary()
    act(() => window.dispatchEvent(new Event(LEGAL_CONSENT_REQUIRED_EVENT)))
    await screen.findByRole('heading', { name: /review voxpery/i })
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument()
    expect(authApiMocks.getLegalConsent).toHaveBeenCalledTimes(1)
  })

  it('invalidates the old snapshot before a failed fresh check, including a remount', async () => {
    useAuthStore.setState({ legalConsent: { ...requiredStatus, required: false } })
    authApiMocks.getLegalConsent.mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce(requiredStatus)
    const view = renderBoundary()
    act(() => window.dispatchEvent(new Event(LEGAL_CONSENT_REQUIRED_EVENT)))
    await screen.findByRole('heading', { name: /could not be checked/i })
    expect(useAuthStore.getState().legalConsent).toBeNull()
    view.unmount()
    renderBoundary()
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument()
    await screen.findByRole('heading', { name: /review voxpery/i })
  })

  it('preserves acknowledgement choices after a failed save and allows an explicit retry', async () => {
    authApiMocks.getLegalConsent.mockResolvedValue(requiredStatus)
    authApiMocks.acknowledgeLegalConsent.mockRejectedValueOnce(new Error('Save failed'))
      .mockResolvedValueOnce({ ...requiredStatus, required: false })
    const user = userEvent.setup()
    renderBoundary()
    await screen.findByRole('heading', { name: /review voxpery/i })
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeChecked()
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }))
    expect(await screen.findByText('Protected application')).toBeInTheDocument()
    expect(authApiMocks.acknowledgeLegalConsent).toHaveBeenCalledTimes(2)
  })

  it('keeps failed status lookup separate from missing consent and recovers without invented acceptance', async () => {
    authApiMocks.getLegalConsent.mockRejectedValueOnce(new Error('Status unavailable'))
      .mockResolvedValueOnce({ ...requiredStatus, required: false })
    const user = userEvent.setup()
    renderBoundary()
    await screen.findByRole('heading', { name: /could not be checked/i })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Protected application')).toBeInTheDocument()
    expect(authApiMocks.acknowledgeLegalConsent).not.toHaveBeenCalled()
  })

  it('does not expose the previous account while a new account status is pending', async () => {
    authApiMocks.getLegalConsent.mockResolvedValueOnce({ ...requiredStatus, required: false })
      .mockImplementationOnce(() => new Promise(() => {}))
    renderBoundary()
    await screen.findByText('Protected application')
    await act(async () => {
      await useAuthStore.getState().setAuth('another-token', { ...useAuthStore.getState().user!, id: 'another-user' })
    })
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument()
  })

  it('allows current consent after a refresh invalidates an in-flight save', async () => {
    let finishOldSave!: (value: typeof requiredStatus) => void
    authApiMocks.getLegalConsent.mockResolvedValue(requiredStatus)
    authApiMocks.acknowledgeLegalConsent.mockImplementationOnce(() => new Promise((resolve) => { finishOldSave = resolve }))
      .mockResolvedValueOnce({ ...requiredStatus, required: false })
    const user = userEvent.setup()
    renderBoundary()
    await screen.findByRole('heading', { name: /review voxpery/i })
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }))
    act(() => window.dispatchEvent(new Event(LEGAL_CONSENT_REQUIRED_EVENT)))
    await screen.findByRole('button', { name: 'Accept and continue' })
    await act(async () => finishOldSave({ ...requiredStatus, required: false }))
    expect(screen.queryByText('Protected application')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept and continue' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }))
    expect(await screen.findByText('Protected application')).toBeInTheDocument()
  })
})
