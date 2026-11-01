import { afterEach, describe, expect, it } from 'vitest'
import { runtimeConfig } from './runtimeConfig'

describe('runtimeConfig', () => {
  afterEach(() => { delete window.__VOXPERY_RUNTIME_CONFIG__ })

  it('is empty when the page has no runtime configuration', () => {
    expect(runtimeConfig()).toEqual({})
  })

  it('returns what the container wrote', () => {
    window.__VOXPERY_RUNTIME_CONFIG__ = { apiUrl: 'https://api.example.org', turnstileSiteKey: 'site-key' }
    expect(runtimeConfig().apiUrl).toBe('https://api.example.org')
    expect(runtimeConfig().turnstileSiteKey).toBe('site-key')
  })
})
