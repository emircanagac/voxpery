import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './auth'

describe('auth store persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({
      token: null,
      user: null,
      loggingOut: false,
    })
  })

  it('does not persist JWT token in localStorage on web', async () => {
    useAuthStore.getState().setAuth('secret-jwt-token', {
      id: 'u1',
      username: 'tester',
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
