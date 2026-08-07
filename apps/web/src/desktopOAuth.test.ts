import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopOAuthDeepLinkHandler,
  parseDesktopOAuthDeepLink,
  registerDesktopOAuthDeepLinks,
  type DesktopOAuthDeepLinkSources,
} from './desktopOAuth'
import { ROUTES } from './routes'
import type { UserPublic } from './api'

const user = { id: 'user-1', username: 'desktop-user' } as UserPublic
const code = '0123456789abcdef0123456789abcdef'

describe('desktop OAuth deep links', () => {
  it('accepts only the Voxpery auth scheme and strips OAuth parameters from the destination', () => {
    expect(parseDesktopOAuthDeepLink(`voxpery://auth/social/dm?room=1&code=${code}#latest`)).toEqual({
      code,
      error: null,
      redirectTo: '/social/dm?room=1#latest',
    })
    expect(parseDesktopOAuthDeepLink(`voxpery://auth/?code=${code}`)?.redirectTo).toBe(ROUTES.servers)
    expect(parseDesktopOAuthDeepLink(`https://auth/social?code=${code}`)).toBeNull()
    expect(parseDesktopOAuthDeepLink(`voxpery://other/social?code=${code}`)).toBeNull()
    expect(parseDesktopOAuthDeepLink('voxpery://auth/social?code=invalid')).toBeNull()
  })

  it('exchanges a valid startup code once and navigates to the requested app route', async () => {
    const exchangeCode = vi.fn().mockResolvedValue({ token: 'desktop-token', user })
    const setAuth = vi.fn()
    const persistToken = vi.fn().mockResolvedValue(undefined)
    const clearCodeVerifier = vi.fn()
    const navigate = vi.fn()
    const handler = createDesktopOAuthDeepLinkHandler({
      getCodeVerifier: () => 'pkce-verifier',
      clearCodeVerifier,
      exchangeCode,
      setAuth,
      persistToken,
      navigate,
    })
    const url = `voxpery://auth/servers?code=${code}`

    await handler(url)
    await handler(url)

    expect(exchangeCode).toHaveBeenCalledTimes(1)
    expect(exchangeCode).toHaveBeenCalledWith(code, 'pkce-verifier')
    expect(setAuth).toHaveBeenCalledWith('desktop-token', user)
    expect(persistToken).toHaveBeenCalledWith('desktop-token')
    expect(clearCodeVerifier).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/servers')
  })

  it('returns to login when the callback cannot be completed', async () => {
    const navigate = vi.fn()
    const onError = vi.fn()
    const handler = createDesktopOAuthDeepLinkHandler({
      getCodeVerifier: () => null,
      clearCodeVerifier: vi.fn(),
      exchangeCode: vi.fn(),
      setAuth: vi.fn(),
      persistToken: vi.fn(),
      navigate,
      onError,
    })

    await handler(`voxpery://auth/servers?code=${code}`)

    expect(onError).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/login?error=oauth_failed&redirect=%2Fservers')
  })

  it('registers runtime listeners and processes the cold-start URL from getCurrent', async () => {
    let opened: ((urls: string[]) => void) | undefined
    let custom: ((url: string) => void) | undefined
    const disposeOpen = vi.fn()
    const disposeCustom = vi.fn()
    const sources: DesktopOAuthDeepLinkSources = {
      getCurrent: vi.fn().mockResolvedValue([`voxpery://auth/servers?code=${code}`]),
      onOpenUrl: vi.fn(async (handler) => {
        opened = handler
        return disposeOpen
      }),
      listenCustom: vi.fn(async (handler) => {
        custom = handler
        return disposeCustom
      }),
    }
    const handler = vi.fn().mockResolvedValue(true)

    const dispose = await registerDesktopOAuthDeepLinks(sources, handler)
    expect(handler).toHaveBeenCalledWith(`voxpery://auth/servers?code=${code}`)

    opened?.(['voxpery://auth/social?error=oauth_failed'])
    custom?.('voxpery://auth/social?error=oauth_failed')
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(3))

    dispose()
    expect(disposeOpen).toHaveBeenCalledTimes(1)
    expect(disposeCustom).toHaveBeenCalledTimes(1)
  })
})
