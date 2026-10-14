import { afterEach, describe, expect, it } from 'vitest'
import { resolveAvatarUrl, resolveInlineMediaUrl, resolveServerIconUrl } from './avatars'
import { setImageProxyGrant } from './imageProxyGrant'

describe('resolveAvatarUrl', () => {
  it('keeps data image avatars unchanged', () => {
    expect(resolveAvatarUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
  })

  it('proxies third-party avatar urls through the API', () => {
    expect(resolveAvatarUrl('https://cdn.example.com/avatar.png')).toBe(
      'http://localhost:3001/api/images/avatar?url=https%3A%2F%2Fcdn.example.com%2Favatar.png',
    )
  })

  it('does not proxy existing API-hosted images', () => {
    expect(resolveAvatarUrl('http://localhost:3001/api/attachments/content/123')).toBe(
      'http://localhost:3001/api/attachments/content/123',
    )
  })
})

describe('remote image resolvers', () => {
  it('proxies server icons through the generic image proxy', () => {
    expect(resolveServerIconUrl('https://cdn.example.com/server.png')).toBe(
      'http://localhost:3001/api/images/remote?url=https%3A%2F%2Fcdn.example.com%2Fserver.png',
    )
  })

  it('proxies inline media previews through the generic image proxy', () => {
    expect(resolveInlineMediaUrl('https://media.example.com/fun.gif')).toBe(
      'http://localhost:3001/api/images/remote?url=https%3A%2F%2Fmedia.example.com%2Ffun.gif',
    )
  })
})

describe('image proxy grants', () => {
  afterEach(() => setImageProxyGrant(null))

  it('appends the signed-in grant to proxied images only', () => {
    setImageProxyGrant('u.abc.1.sig/+')
    expect(resolveAvatarUrl('https://cdn.example.com/avatar.png')).toBe(
      'http://localhost:3001/api/images/avatar?url=https%3A%2F%2Fcdn.example.com%2Favatar.png&grant=u.abc.1.sig%2F%2B',
    )
    expect(resolveAvatarUrl('http://localhost:3001/api/attachments/content/123')).toBe(
      'http://localhost:3001/api/attachments/content/123',
    )
  })

  it('prefers the invite preview grant for server icons', () => {
    setImageProxyGrant('u.abc.1.sig')
    expect(resolveServerIconUrl('https://cdn.example.com/server.png', 'i.1.icon')).toBe(
      'http://localhost:3001/api/images/remote?url=https%3A%2F%2Fcdn.example.com%2Fserver.png&grant=i.1.icon',
    )
    setImageProxyGrant(null)
    expect(resolveServerIconUrl('https://cdn.example.com/server.png')).toBe(
      'http://localhost:3001/api/images/remote?url=https%3A%2F%2Fcdn.example.com%2Fserver.png',
    )
  })
})
