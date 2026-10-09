import { afterEach, describe, it, expect, vi } from 'vitest'
import { isTauri, getSecureToken, setSecureToken, removeSecureToken } from './secureStorage'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

describe('secureStorage', () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__
    invoke.mockReset()
  })

  it('propagates a sanitized keyring error instead of an empty credential', async () => {
    window.__TAURI_INTERNALS__ = {}
    for (const action of [getSecureToken, () => setSecureToken('secret'), removeSecureToken]) {
      invoke.mockRejectedValueOnce(new Error('keyring detail contains secret'))
      await expect(action()).rejects.toThrow(/^SECURE_STORAGE_ERROR:Could not access the system keyring/)
    }
  })

  it('serializes an outstanding write before delete and recovers after a failed operation', async () => {
    window.__TAURI_INTERNALS__ = {}
    let finish!: () => void
    invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(null)
    const write = setSecureToken('secret')
    const remove = removeSecureToken()
    const failure = expect(remove).rejects.toThrow('SECURE_STORAGE_ERROR')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    finish()
    await write
    await failure
    expect(await getSecureToken()).toBeNull()
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'plugin:secure-storage|set_item', 'plugin:secure-storage|remove_item', 'plugin:secure-storage|get_item',
    ])
  })
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
