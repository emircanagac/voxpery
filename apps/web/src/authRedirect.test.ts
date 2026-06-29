import { describe, expect, it } from 'vitest'
import { resolvePostAuthRoute } from './authRedirect'
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
})
