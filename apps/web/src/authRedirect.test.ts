import { describe, expect, it } from 'vitest'
import { rememberExpiredSession, resolvePostAuthRoute, takeExpiredSession } from './authRedirect'
import { ROUTES } from './routes'

describe('auth redirect resolution', () => {
  it('opens the community server surface by default after auth', () => {
    expect(resolvePostAuthRoute()).toBe(ROUTES.servers)
    expect(resolvePostAuthRoute('')).toBe(ROUTES.servers)
  })

  it('keeps explicit redirect paths from invite and protected routes', () => {
    expect(resolvePostAuthRoute('/invite/abc')).toBe('/invite/abc')
    expect(resolvePostAuthRoute('/social/dm')).toBe('/social/dm')
  })

  it('remembers an expired session once, with a safe return path', () => {
    rememberExpiredSession('/social/dm?tab=1')
    expect(takeExpiredSession()).toEqual({ returnTo: '/social/dm?tab=1' })
    expect(takeExpiredSession()).toBeNull()

    rememberExpiredSession('/login?redirect=%2Fservers')
    expect(takeExpiredSession()).toEqual({})
    rememberExpiredSession('//evil.example')
    expect(takeExpiredSession()).toEqual({})
  })
})
