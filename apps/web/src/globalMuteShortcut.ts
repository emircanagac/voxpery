import { isTauri } from './secureStorage'

export const GLOBAL_MUTE_SHORTCUT_STORAGE_KEY = 'voxpery-settings-global-mute-shortcut'
export const GLOBAL_MUTE_SHORTCUT_EVENT = 'voxpery-global-mute-shortcut'

let registeredDesktopShortcut: string | null = null
let shortcutCaptureActive = false

const KEY_ALIASES: Record<string, string> = {
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ArrowUp: 'ArrowUp',
  Backquote: 'Backquote',
  Backslash: 'Backslash',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Comma: 'Comma',
  Equal: 'Equal',
  Minus: 'Minus',
  Period: 'Period',
  Quote: 'Quote',
  Semicolon: 'Semicolon',
  Slash: 'Slash',
  Space: 'Space',
}

function shortcutKeyFromEvent(event: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code
  return KEY_ALIASES[event.code] ?? null
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = shortcutKeyFromEvent(event)
  if (!key) return null

  const modifiers: string[] = []
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (modifiers.length === 0) return null

  return [...modifiers, key].join('+')
}

export function formatGlobalMuteShortcut(shortcut: string | null): string {
  if (!shortcut) return 'Not assigned'
  return shortcut
    .replace('CommandOrControl', 'Ctrl/Cmd')
    .replace('ArrowUp', 'Up')
    .replace('ArrowDown', 'Down')
    .replace('ArrowLeft', 'Left')
    .replace('ArrowRight', 'Right')
}

export function keyboardEventMatchesShortcut(event: KeyboardEvent, shortcut: string | null): boolean {
  if (!shortcut || event.repeat) return false
  return shortcutFromKeyboardEvent(event) === shortcut
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

export function getStoredGlobalMuteShortcut(): string | null {
  try {
    return localStorage.getItem(GLOBAL_MUTE_SHORTCUT_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeGlobalMuteShortcut(shortcut: string | null): void {
  try {
    if (shortcut) {
      localStorage.setItem(GLOBAL_MUTE_SHORTCUT_STORAGE_KEY, shortcut)
    } else {
      localStorage.removeItem(GLOBAL_MUTE_SHORTCUT_STORAGE_KEY)
    }
  } catch {
    // The active registration still works for this session.
  }
}

export function dispatchGlobalMuteShortcut(): void {
  if (shortcutCaptureActive) return
  window.dispatchEvent(new Event(GLOBAL_MUTE_SHORTCUT_EVENT))
}

export function setGlobalMuteShortcutCaptureActive(active: boolean): void {
  shortcutCaptureActive = active
}

export async function registerDesktopGlobalMuteShortcut(shortcut: string | null): Promise<void> {
  if (!isTauri()) return

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
    await register(shortcut, (event) => {
      if (event.state === 'Pressed') dispatchGlobalMuteShortcut()
    })
    registeredDesktopShortcut = shortcut
  } catch (error) {
    if (previous) {
      try {
        await register(previous, (event) => {
          if (event.state === 'Pressed') dispatchGlobalMuteShortcut()
        })
        registeredDesktopShortcut = previous
      } catch {
        registeredDesktopShortcut = null
      }
    }
    throw error
  }
}

export async function applyGlobalMuteShortcut(shortcut: string | null): Promise<void> {
  await registerDesktopGlobalMuteShortcut(shortcut)
  storeGlobalMuteShortcut(shortcut)
}

export function resetGlobalMuteShortcutRegistrationForTests(): void {
  registeredDesktopShortcut = null
  shortcutCaptureActive = false
}
