import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GLOBAL_PUSH_TO_TALK_EVENT,
  pushToTalkShortcutFromKey,
  registerDesktopGlobalPushToTalk,
  resetGlobalPushToTalkRegistrationForTests,
  setGlobalPushToTalkCaptureActive,
} from './globalPushToTalk'

const shortcutMocks = vi.hoisted(() => ({
  isRegistered: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-global-shortcut', () => shortcutMocks)

describe('desktop global push-to-talk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shortcutMocks.isRegistered.mockResolvedValue(false)
    shortcutMocks.register.mockResolvedValue(undefined)
    shortcutMocks.unregister.mockResolvedValue(undefined)
    resetGlobalPushToTalkRegistrationForTests()
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('normalizes legacy key values into Tauri shortcuts', () => {
    expect(pushToTalkShortcutFromKey('v')).toBe('V')
    expect(pushToTalkShortcutFromKey(' ')).toBe('Space')
    expect(pushToTalkShortcutFromKey('Space')).toBe('Space')
    expect(pushToTalkShortcutFromKey('F12')).toBe('F12')
    expect(pushToTalkShortcutFromKey('Control')).toBeNull()
  })

  it('forwards both press and release while the app is unfocused', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    const states: string[] = []
    const listener = (event: Event) => {
      states.push((event as CustomEvent<string>).detail)
    }
    window.addEventListener(GLOBAL_PUSH_TO_TALK_EVENT, listener)

    await registerDesktopGlobalPushToTalk('V')
    const handler = shortcutMocks.register.mock.calls[0]?.[1] as
      | ((event: { state: 'Pressed' | 'Released' }) => void)
      | undefined
    handler?.({ state: 'Pressed' })
    handler?.({ state: 'Released' })

    expect(shortcutMocks.register).toHaveBeenCalledWith('V', expect.any(Function))
    expect(states).toEqual(['Pressed', 'Released'])
    window.removeEventListener(GLOBAL_PUSH_TO_TALK_EVENT, listener)
  })

  it('suppresses transmission while key capture is active', async () => {
    ;(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    const listener = vi.fn()
    window.addEventListener(GLOBAL_PUSH_TO_TALK_EVENT, listener)
    setGlobalPushToTalkCaptureActive(true)

    await registerDesktopGlobalPushToTalk('V')
    const handler = shortcutMocks.register.mock.calls[0]?.[1] as
      | ((event: { state: 'Pressed' | 'Released' }) => void)
      | undefined
    handler?.({ state: 'Pressed' })

    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(GLOBAL_PUSH_TO_TALK_EVENT, listener)
  })
})
