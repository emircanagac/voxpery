import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyGlobalMuteShortcut,
  formatGlobalMuteShortcut,
  GLOBAL_MUTE_SHORTCUT_EVENT,
  keyboardEventMatchesShortcut,
  muteShortcutConflictsWithPushToTalk,
  resetGlobalMuteShortcutRegistrationForTests,
  setGlobalMuteShortcutCaptureActive,
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

  it('accepts single keys and normalizes cross-platform control keys', () => {
    expect(shortcutFromKeyboardEvent(keyEvent('KeyM'))).toBe('M')
    expect(shortcutFromKeyboardEvent(keyEvent('KeyF'))).toBe('F')
    expect(shortcutFromKeyboardEvent(keyEvent('F5'))).toBe('F5')
    expect(shortcutFromKeyboardEvent(keyEvent('ArrowLeft'))).toBeNull()
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
    expect(keyboardEventMatchesShortcut(keyEvent('KeyF'), 'F')).toBe(true)
    expect(keyboardEventMatchesShortcut(keyEvent('KeyF', { ctrlKey: true }), 'F')).toBe(false)
  })

  it.each(['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F24'])('captures the supported single key %s', (code) => {
    expect(shortcutFromKeyboardEvent(keyEvent(code))).toBe(code.replace(/^Key|^Digit/, ''))
  })

  it.each(['Space', 'ArrowUp', 'Slash', 'Backquote'])('captures %s with modifiers, not as a bare key', (code) => {
    expect(shortcutFromKeyboardEvent(keyEvent(code))).toBeNull()
    expect(shortcutFromKeyboardEvent(keyEvent(code, { ctrlKey: true }))).toBe(`CommandOrControl+${code}`)
  })

  it.each(['Escape', 'ShiftLeft', 'ControlLeft', 'Numpad1', 'Enter', 'Tab'])('does not silently assign unsupported %s', (code) => {
    expect(shortcutFromKeyboardEvent(keyEvent(code))).toBeNull()
  })

  it('detects single-key push-to-talk conflicts', () => {
    localStorage.setItem('voxpery-settings-voice-mode', 'push_to_talk')
    localStorage.setItem('voxpery-settings-ptt-key', 'V')
    expect(muteShortcutConflictsWithPushToTalk('V')).toBe(true)
    expect(muteShortcutConflictsWithPushToTalk('F')).toBe(false)
    expect(muteShortcutConflictsWithPushToTalk('Control+V')).toBe(false)
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
    expect(localStorage.getItem('voxpery-settings-global-mute-shortcut')).toBe('CommandOrControl+Shift+M')
  })

  it('retains one registration on reload, suppresses capture, and clears the shortcut', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    shortcutMocks.register.mockResolvedValue(undefined)
    const listener = vi.fn()
    window.addEventListener(GLOBAL_MUTE_SHORTCUT_EVENT, listener)
    try {
      await applyGlobalMuteShortcut('F5')
      shortcutMocks.isRegistered.mockResolvedValue(true)
      await applyGlobalMuteShortcut('F5')
      expect(shortcutMocks.register).toHaveBeenCalledOnce()
      const handler = shortcutMocks.register.mock.calls[0][1]
      setGlobalMuteShortcutCaptureActive(true)
      handler({ state: 'Pressed' })
      expect(listener).not.toHaveBeenCalled()
      setGlobalMuteShortcutCaptureActive(false)
      handler({ state: 'Pressed' })
      expect(listener).toHaveBeenCalledOnce()
      await applyGlobalMuteShortcut(null)
      expect(shortcutMocks.unregister).toHaveBeenCalledWith('F5')
      expect(localStorage.getItem('voxpery-settings-global-mute-shortcut')).toBeNull()
    } finally {
      window.removeEventListener(GLOBAL_MUTE_SHORTCUT_EVENT, listener)
    }
  })
})
