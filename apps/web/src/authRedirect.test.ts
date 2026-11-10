import { describe, expect, it } from 'vitest'
import { rememberExpiredSession, resolvePostAuthRoute, safeRedirectPath, takeExpiredSession } from './authRedirect'
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

  it('accepts in-app redirect paths', () => {
    expect(safeRedirectPath('/invite/abc')).toBe('/invite/abc')
    expect(safeRedirectPath('  /social/dm?tab=1#top  ')).toBe('/social/dm?tab=1#top')
    expect(safeRedirectPath('/servers/%2F%2Fexample.com')).toBe('/servers/%2F%2Fexample.com')
  })

  it('rejects redirects that a URL parser can turn into another origin', () => {
    const backslash = String.fromCharCode(92)
    for (const value of [
      null,
      '',
      'servers',
      'https://example.com',
      '//example.com',
      '/\t/example.com',
      '/\n/example.com',
      '/\r/example.com',
      '/\t\t/example.com',
      `/${backslash}example.com`,
      `/${backslash}/example.com`,
      '/ /example.com',
      '/\u0000/example.com',
      '/\u007f/example.com',
      '/ /example.com',
    ]) {
      expect(safeRedirectPath(value), JSON.stringify(value)).toBeUndefined()
    }
  })

  it('remembers an expired session once, with a safe return path', () => {
    rememberExpiredSession('/social/dm?tab=1')
    expect(takeExpiredSession()).toEqual({ returnTo: '/social/dm?tab=1' })
    expect(takeExpiredSession()).toBeNull()

    rememberExpiredSession('/login?redirect=%2Fservers')
    expect(takeExpiredSession()).toEqual({})
    rememberExpiredSession('//evil.example')
    expect(takeExpiredSession()).toEqual({})
    rememberExpiredSession('/\t/evil.example')
    expect(takeExpiredSession()).toEqual({})
  })
})
