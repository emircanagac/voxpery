import { isTauri } from './secureStorage'

export const GLOBAL_PUSH_TO_TALK_EVENT = 'voxpery-global-push-to-talk'

export type GlobalPushToTalkState = 'Pressed' | 'Released'

let registeredDesktopShortcut: string | null = null
let shortcutCaptureActive = false

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Space: 'Space',
  Spacebar: 'Space',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  Backspace: 'Backspace',
  Delete: 'Delete',
  End: 'End',
  Enter: 'Enter',
  Home: 'Home',
  Insert: 'Insert',
  PageDown: 'PageDown',
  PageUp: 'PageUp',
  Tab: 'Tab',
  '`': 'Backquote',
  '\\': 'Backslash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
  '=': 'Equal',
  '-': 'Minus',
  '.': 'Period',
  "'": 'Quote',
  ';': 'Semicolon',
  '/': 'Slash',
}

export function pushToTalkShortcutFromKey(key: string | null): string | null {
  if (!key) return null
  const trimmed = key.trim()
  if (!trimmed && key !== ' ') return null
  if (/^[a-z0-9]$/i.test(trimmed)) return trimmed.toUpperCase()
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) return trimmed.toUpperCase()
  if (['Alt', 'Control', 'Meta', 'Shift', 'Escape'].includes(trimmed)) return null
  return KEY_ALIASES[key] ?? KEY_ALIASES[trimmed] ?? null
}

export function dispatchGlobalPushToTalk(state: GlobalPushToTalkState): void {
  if (shortcutCaptureActive) return
  window.dispatchEvent(new CustomEvent<GlobalPushToTalkState>(GLOBAL_PUSH_TO_TALK_EVENT, {
    detail: state,
  }))
}

export function setGlobalPushToTalkCaptureActive(active: boolean): void {
  shortcutCaptureActive = active
}

function desktopHandler(event: { state: GlobalPushToTalkState }) {
  dispatchGlobalPushToTalk(event.state)
}

export async function registerDesktopGlobalPushToTalk(key: string | null): Promise<void> {
  if (!isTauri()) return

  const shortcut = pushToTalkShortcutFromKey(key)
  const { isRegistered, register, unregister } = await import('@tauri-apps/plugin-global-shortcut')
  if (registeredDesktopShortcut === shortcut && shortcut && await isRegistered(shortcut)) return
  if (registeredDesktopShortcut === shortcut) registeredDesktopShortcut = null

  const previous = registeredDesktopShortcut
  if (previous) {
    await unregister(previous)
    registeredDesktopShortcut = null
  }

  if (!shortcut) return

  try {
    if (await isRegistered(shortcut)) await unregister(shortcut)
    await register(shortcut, desktopHandler)
    registeredDesktopShortcut = shortcut
  } catch (error) {
    if (previous) {
      try {
        await register(previous, desktopHandler)
        registeredDesktopShortcut = previous
      } catch {
        registeredDesktopShortcut = null
      }
    }
    throw error
  }
}

export function resetGlobalPushToTalkRegistrationForTests(): void {
  registeredDesktopShortcut = null
  shortcutCaptureActive = false
}
