import { describe, it, expect } from 'vitest'
import { isTauri } from './secureStorage'

describe('secureStorage', () => {
  describe('isTauri', () => {
    it('should return false in test environment', () => {
      expect(isTauri()).toBe(false)
    })

    it('should detect Tauri from window properties', () => {
      // Mock Tauri v2 environment
      const originalWindow = globalThis.window
      ;(globalThis as unknown as { window: unknown }).window = {
        ...originalWindow,
        __TAURI_INTERNALS__: {},
      }

      expect(isTauri()).toBe(true)

      // Restore
      ;(globalThis as unknown as { window: unknown }).window = originalWindow
    })
  })
})
