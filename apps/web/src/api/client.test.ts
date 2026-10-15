import { afterEach, describe, expect, it } from 'vitest'
import { desktopServerApiBase } from './client'

describe('desktopServerApiBase', () => {
  afterEach(() => {
    delete window.__VOXPERY_DESKTOP_SERVER__
  })

  it('reads the server the desktop shell chose, if any', () => {
    expect(desktopServerApiBase()).toBeUndefined()
    window.__VOXPERY_DESKTOP_SERVER__ = { apiBase: 'https://chat.example.org' }
    expect(desktopServerApiBase()).toBe('https://chat.example.org')
  })
})
