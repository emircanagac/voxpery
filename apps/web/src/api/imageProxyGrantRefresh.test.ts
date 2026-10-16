import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getImageProxyGrant, setImageProxyGrant } from './imageProxyGrant'
import { refreshImageProxyGrant } from './imageProxyGrantRefresh'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ apiFetch }))

describe('refreshImageProxyGrant', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    setImageProxyGrant('old-grant')
  })

  it('replaces the grant with one for the current sign-in', async () => {
    apiFetch.mockResolvedValue({ grant: 'new-grant', expires_at: 1 })
    await refreshImageProxyGrant('desktop-token')
    expect(apiFetch).toHaveBeenCalledWith('/api/images/grant', { token: 'desktop-token' })
    expect(getImageProxyGrant()).toBe('new-grant')
  })

  it('uses the web session cookie when there is no token and keeps the grant on failure', async () => {
    apiFetch.mockRejectedValue(new Error('offline'))
    await expect(refreshImageProxyGrant(null)).rejects.toThrow('offline')
    expect(apiFetch).toHaveBeenCalledWith('/api/images/grant', { token: undefined })
    expect(getImageProxyGrant()).toBe('old-grant')
  })
})
