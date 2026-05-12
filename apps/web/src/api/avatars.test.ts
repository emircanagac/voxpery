import { describe, expect, it } from 'vitest'
import { resolveAvatarUrl } from './avatars'

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
