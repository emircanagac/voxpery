import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from './auth'
import type { UserPublic } from '../api'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), logout: vi.fn(async () => {}), desktop: vi.fn(() => false),
  getToken: vi.fn(), setToken: vi.fn(async () => {}), removeToken: vi.fn(async () => {}),
}))
vi.mock('../secureStorage', () => ({
  isTauri: mocks.desktop, getSecureToken: mocks.getToken,
  setSecureToken: mocks.setToken, removeSecureToken: mocks.removeToken,
}))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, authApi: { ...actual.authApi, getSession: mocks.session, logout: mocks.logout } }
})

const user: UserPublic = { id: 'u1', username: 'tester', email: 'tester@example.test', email_verified: true, status: 'online', dm_privacy: 'friends' }
const consent = {
  required: false, current_terms_version: '2026-08-23',
  current_privacy_notice_version: '2026-08-23', current_kvkk_notice_version: '2026-08-23',
}

describe('auth store persistence', () => {
  beforeEach(() => {
    mocks.desktop.mockReturnValue(false)
    useAuthStore.getState().clearSession()
    vi.clearAllMocks()
    mocks.session.mockReset()
    localStorage.clear()
    useAuthStore.setState({
      token: null,
      user: null,
      loggingOut: false,
      sessionState: 'idle', sessionError: null, legalConsent: null,
    })
  })

  it('coalesces concurrent startup calls into one server session snapshot', async () => {
    let finish!: (value: { user: typeof user; legal_consent: typeof consent }) => void
    mocks.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = useAuthStore.getState().restoreSession()
    const second = useAuthStore.getState().restoreSession()
    expect(first).toBe(second)
    expect(mocks.session).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().sessionState).toBe('loading')
    finish({ user, legal_consent: consent })
    await first
    expect(useAuthStore.getState()).toMatchObject({ user, legalConsent: consent, sessionState: 'ready', token: null })
    const saved = JSON.parse(localStorage.getItem('voxpery-auth')!)
    expect(saved.state).not.toHaveProperty('legalConsent')
    expect(saved.state).not.toHaveProperty('sessionState')
  })

  it('ignores persisted session validity and document flags on reload', async () => {
    localStorage.setItem('voxpery-auth', JSON.stringify({
      version: 2, state: { user, token: 'untrusted', legalConsent: consent, sessionState: 'ready' },
    }))
    await useAuthStore.persist.rehydrate()
    expect(useAuthStore.getState()).toMatchObject({ user, token: null, legalConsent: null, sessionState: 'idle' })
  })

  it('does not let a late previous-account response replace a new account', async () => {
    let finish!: (value: { user: typeof user; legal_consent: typeof consent }) => void
    mocks.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const old = useAuthStore.getState().restoreSession()
    const nextUser = { ...user, id: 'u2', username: 'another' }
    useAuthStore.getState().setAuth('next-token', nextUser)
    mocks.session.mockResolvedValueOnce({ user: nextUser, legal_consent: { ...consent, required: true } })
    await useAuthStore.getState().restoreSession()
    finish({ user, legal_consent: consent })
    await old
    expect(useAuthStore.getState()).toMatchObject({ user: nextUser, legalConsent: { required: true }, sessionState: 'ready' })
  })

  it('does not let a late bootstrap authentication error clear a newer session', async () => {
    let reject!: (error: Error) => void
    mocks.session.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const old = useAuthStore.getState().restoreSession()
    const nextUser = { ...user, id: 'u2' }
    useAuthStore.getState().setAuth('next-token', nextUser)
    mocks.session.mockResolvedValueOnce({ user: nextUser, legal_consent: consent })
    await useAuthStore.getState().restoreSession()
    reject(new Error('Authentication required'))
    await old
    expect(useAuthStore.getState()).toMatchObject({ user: nextUser, legalConsent: consent, sessionState: 'ready' })
  })

  it('does not restore a session after logout while startup is pending', async () => {
    let finish!: (value: { user: typeof user; legal_consent: typeof consent }) => void
    mocks.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = useAuthStore.getState().restoreSession()
    useAuthStore.getState().logout()
    finish({ user, legal_consent: consent })
    await pending
    expect(useAuthStore.getState()).toMatchObject({ user: null, legalConsent: null, sessionState: 'ready' })
  })

  it('keeps unavailable status distinct from consent and allows explicit retry', async () => {
    mocks.session.mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ user, legal_consent: consent })
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState()).toMatchObject({ sessionState: 'error', legalConsent: null })
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState()).toMatchObject({ sessionState: 'ready', legalConsent: consent })
  })

  it('clears stale profile hints for an expired cookie', async () => {
    useAuthStore.setState({ user })
    mocks.session.mockRejectedValueOnce(new Error('Authentication required (401)'))
    await useAuthStore.getState().restoreSession()
    expect(useAuthStore.getState()).toMatchObject({ sessionState: 'ready', user: null, token: null, legalConsent: null })
  })

  it('restores desktop credentials with the same combined session request', async () => {
    mocks.desktop.mockReturnValue(true)
    mocks.getToken.mockResolvedValue('secure-token')
    mocks.session.mockResolvedValue({ user, legal_consent: consent })
    await useAuthStore.getState().restoreSession()
    expect(mocks.session).toHaveBeenCalledWith('secure-token')
    expect(useAuthStore.getState()).toMatchObject({ token: 'secure-token', user, legalConsent: consent })
  })

  it('does not call the server when desktop has no secure token', async () => {
    mocks.desktop.mockReturnValue(true)
    mocks.getToken.mockResolvedValue(null)
    await useAuthStore.getState().restoreSession()
    expect(mocks.session).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ user: null, sessionState: 'ready' })
  })

  it('ignores secure-storage reads that finish after logout', async () => {
    mocks.desktop.mockReturnValue(true)
    let finish!: (token: string) => void
    mocks.getToken.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = useAuthStore.getState().restoreSession()
    useAuthStore.getState().logout()
    finish('old-token')
    await pending
    expect(mocks.session).not.toHaveBeenCalled()
    expect(useAuthStore.getState()).toMatchObject({ user: null, token: null, legalConsent: null })
  })

  it('does not apply consent metadata to a different current identity', () => {
    useAuthStore.getState().setAuth('new-token', { ...user, id: 'u2' })
    useAuthStore.getState().setLegalConsent(consent, user.id, 'old-token')
    expect(useAuthStore.getState().legalConsent).toBeNull()
  })

  it('does not persist JWT token in localStorage on web', async () => {
    useAuthStore.getState().setAuth('secret-jwt-token', {
      id: 'u1',
      username: 'tester',
      email: 'tester@example.test',
      email_verified: true,
      status: 'online',
      dm_privacy: 'friends',
    })

    // persist middleware writes after state update
    await Promise.resolve()

    const raw = localStorage.getItem('voxpery-auth')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string) as {
      state: { token: string | null; user: { username: string } | null }
      version: number
    }
    expect(parsed.state.token).toBeNull()
    expect(parsed.state.user?.username).toBe('tester')
  })
})
