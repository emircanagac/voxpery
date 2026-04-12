import { isTauri } from './secureStorage'

const MINIMIZE_TO_TRAY_ON_CLOSE_KEY = 'voxpery-settings-minimize-to-tray-on-close'
const AUTOSTART_PREFERENCE_KEY = 'voxpery-settings-autostart-preference'

function readBoolSetting(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key)
    if (value == null) return fallback
    return value === '1'
  } catch {
    return fallback
  }
}

function writeBoolSetting(key: string, enabled: boolean) {
  try {
    localStorage.setItem(key, enabled ? '1' : '0')
  } catch {
    // ignore storage errors
  }
}

function hasStoredSetting(key: string) {
  try {
    return localStorage.getItem(key) != null
  } catch {
    return false
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

export function shouldEnableDesktopAutostartByDefault() {
  if (!isTauri()) return false
  if (hasStoredSetting(AUTOSTART_PREFERENCE_KEY)) return false
  if (typeof navigator === 'undefined') return false
  const platformSignal = `${navigator.userAgent ?? ''} ${navigator.platform ?? ''}`.toLowerCase()
  return platformSignal.includes('windows') || platformSignal.includes('win32') || platformSignal.includes('win64')
}

export function setStoredDesktopAutostartPreference(enabled: boolean) {
  writeBoolSetting(AUTOSTART_PREFERENCE_KEY, enabled)
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
  writeBoolSetting(MINIMIZE_TO_TRAY_ON_CLOSE_KEY, enabled)
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('desktop_set_minimize_to_tray_on_close', { enabled })
}

export async function prepareDesktopForUpdateInstall() {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('desktop_prepare_for_update_install')
}
