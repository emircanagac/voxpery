import { isTauri } from './secureStorage'

const MINIMIZE_TO_TRAY_ON_CLOSE_KEY = 'voxpery-settings-minimize-to-tray-on-close'
const AUTOSTART_PREFERENCE_KEY = 'voxpery-settings-autostart-preference'
const ENABLED_VALUE = '1'
const DISABLED_VALUE = '0'

function normalizeBoolValue(value: string | null | undefined): boolean | null {
  if (value === ENABLED_VALUE) return true
  if (value === DISABLED_VALUE) return false
  return null
}

function readOptionalBoolSetting(key: string) {
  try {
    const value = localStorage.getItem(key)
    return normalizeBoolValue(value)
  } catch {
    return null
  }
}

function readBoolSetting(key: string, fallback: boolean) {
  return readOptionalBoolSetting(key) ?? fallback
}

function writeLocalBoolSetting(key: string, enabled: boolean) {
  try {
    localStorage.setItem(key, enabled ? ENABLED_VALUE : DISABLED_VALUE)
  } catch {
    // ignore storage errors
  }
}

async function readNativeBoolSetting(key: string): Promise<boolean | null> {
  if (!isTauri()) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const out = await invoke('plugin:secure-storage|get_item', {
      payload: { prefixedKey: key },
    })
    if (typeof out === 'string') return normalizeBoolValue(out)
    const obj = out as { data?: string | null } | null
    return normalizeBoolValue(obj?.data)
  } catch {
    return null
  }
}

async function writeNativeBoolSetting(key: string, enabled: boolean) {
  if (!isTauri()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('plugin:secure-storage|set_item', {
      payload: { prefixedKey: key, data: enabled ? ENABLED_VALUE : DISABLED_VALUE },
    })
  } catch {
    // localStorage remains a best-effort fallback.
  }
}

export function getStoredMinimizeToTrayOnCloseEnabled() {
  return readBoolSetting(MINIMIZE_TO_TRAY_ON_CLOSE_KEY, true)
}

export async function getDesktopAutostartEnabled() {
  if (!isTauri()) return false
  const { isEnabled } = await import('@tauri-apps/plugin-autostart')
  return isEnabled()
}

export async function setDesktopAutostartEnabled(enabled: boolean) {
  if (!isTauri()) return
  const { enable, disable } = await import('@tauri-apps/plugin-autostart')
  if (enabled) {
    await enable()
    return
  }
  await disable()
}

async function getStoredDesktopAutostartPreference(): Promise<boolean | null> {
  const nativeValue = await readNativeBoolSetting(AUTOSTART_PREFERENCE_KEY)
  if (nativeValue != null) return nativeValue

  const localValue = readOptionalBoolSetting(AUTOSTART_PREFERENCE_KEY)
  if (localValue != null) {
    await writeNativeBoolSetting(AUTOSTART_PREFERENCE_KEY, localValue)
  }
  return localValue
}

export async function shouldEnableDesktopAutostartByDefault() {
  if (!isTauri()) return false
  if ((await getStoredDesktopAutostartPreference()) != null) return false
  if (typeof navigator === 'undefined') return false
  const platformSignal = `${navigator.userAgent ?? ''} ${navigator.platform ?? ''}`.toLowerCase()
  return platformSignal.includes('windows') || platformSignal.includes('win32') || platformSignal.includes('win64')
}

export async function bootstrapDesktopAutostartDefault(): Promise<boolean | null> {
  if (!(await shouldEnableDesktopAutostartByDefault())) return null

  const enabled = await getDesktopAutostartEnabled()
  if (!enabled) {
    await setDesktopAutostartEnabled(true)
  }
  await setStoredDesktopAutostartPreference(true)
  return true
}

export async function setStoredDesktopAutostartPreference(enabled: boolean) {
  writeLocalBoolSetting(AUTOSTART_PREFERENCE_KEY, enabled)
  await writeNativeBoolSetting(AUTOSTART_PREFERENCE_KEY, enabled)
}

export function getDesktopStartupTargetLabel() {
  if (typeof navigator === 'undefined') return 'your computer starts'
  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) return 'macOS starts'
  if (userAgent.includes('linux')) return 'Linux starts'
  if (userAgent.includes('windows')) return 'Windows starts'
  return 'your computer starts'
}

export async function setDesktopMinimizeToTrayOnClose(enabled: boolean) {
  writeLocalBoolSetting(MINIMIZE_TO_TRAY_ON_CLOSE_KEY, enabled)
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('desktop_set_minimize_to_tray_on_close', { enabled })
}

export async function prepareDesktopForUpdateInstall() {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('desktop_prepare_for_update_install')
}
