import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyGlobalMuteShortcut,
  formatGlobalMuteShortcut,
  GLOBAL_MUTE_SHORTCUT_EVENT,
  keyboardEventMatchesShortcut,
  resetGlobalMuteShortcutRegistrationForTests,
  shortcutFromKeyboardEvent,
} from './globalMuteShortcut'

const shortcutMocks = vi.hoisted(() => ({
  isRegistered: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-global-shortcut', () => shortcutMocks)

function keyEvent(code: string, options: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { code, ...options })
}

describe('global mute shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shortcutMocks.isRegistered.mockResolvedValue(false)
    localStorage.clear()
    resetGlobalMuteShortcutRegistrationForTests()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('requires a modifier and normalizes cross-platform control keys', () => {
    expect(shortcutFromKeyboardEvent(keyEvent('KeyM'))).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent('KeyM', { ctrlKey: true, shiftKey: true })))
      .toBe('CommandOrControl+Shift+M')
    expect(shortcutFromKeyboardEvent(keyEvent('KeyM', { metaKey: true, shiftKey: true })))
      .toBe('CommandOrControl+Shift+M')
  })

  it('formats and matches stored shortcuts without repeating', () => {
    const shortcut = 'CommandOrControl+Shift+M'
    expect(formatGlobalMuteShortcut(shortcut)).toBe('Ctrl/Cmd+Shift+M')
    expect(keyboardEventMatchesShortcut(keyEvent('KeyM', { ctrlKey: true, shiftKey: true }), shortcut)).toBe(true)
    expect(keyboardEventMatchesShortcut(keyEvent('KeyM', { ctrlKey: true, shiftKey: true, repeat: true }), shortcut)).toBe(false)
  })

  it('registers desktop shortcuts and dispatches only pressed events', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    shortcutMocks.register.mockResolvedValue(undefined)
    const listener = vi.fn()
    window.addEventListener(GLOBAL_MUTE_SHORTCUT_EVENT, listener)

    await applyGlobalMuteShortcut('CommandOrControl+Shift+M')
    const handler = shortcutMocks.register.mock.calls[0]?.[1] as
      | ((event: { state: 'Pressed' | 'Released' }) => void)
      | undefined
    handler?.({ state: 'Released' })
    handler?.({ state: 'Pressed' })

    expect(shortcutMocks.register).toHaveBeenCalledWith('CommandOrControl+Shift+M', expect.any(Function))
    expect(listener).toHaveBeenCalledOnce()
    window.removeEventListener(GLOBAL_MUTE_SHORTCUT_EVENT, listener)
  })

  it('restores the previous registration when rebinding fails', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    shortcutMocks.register.mockResolvedValueOnce(undefined)
    await applyGlobalMuteShortcut('CommandOrControl+Shift+M')

    shortcutMocks.register
      .mockRejectedValueOnce(new Error('Shortcut unavailable'))
      .mockResolvedValueOnce(undefined)

    await expect(applyGlobalMuteShortcut('Alt+Shift+M')).rejects.toThrow('Shortcut unavailable')
    expect(shortcutMocks.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+M')
    expect(shortcutMocks.register).toHaveBeenLastCalledWith('CommandOrControl+Shift+M', expect.any(Function))
  })
})
