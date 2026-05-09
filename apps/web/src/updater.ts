/**
 * Desktop (Tauri) update check. Only runs when running inside Tauri (v1 or v2).
 * In browser, checkForUpdates is a no-op.
 */
import { isTauri } from './secureStorage'
import { prepareDesktopForUpdateInstall } from './desktopSettings'

export type UpdateResult =
  | { available: false; error?: boolean }
  | { available: true; version: string; body?: string; date?: string }

export const DESKTOP_UPDATE_STATUS_EVENT = 'voxpery-desktop-update-status'

export type DesktopUpdateStatusDetail = {
  result: UpdateResult
}

type DesktopUpdate = {
  version: string
  body?: string | null
  date?: string | null
  downloadAndInstall: () => Promise<void>
}

type DesktopUpdaterRuntime = {
  isDesktop: () => boolean
  check: () => Promise<DesktopUpdate | null>
  prepareForInstall: () => Promise<void>
  relaunch: () => Promise<void>
}

function logUpdaterError(scope: string, error: unknown) {
  if (!import.meta.env.DEV) return
  console.error(`[desktop-updater] ${scope}`, error)
}

function emitDesktopUpdateStatus(result: UpdateResult) {
  window.dispatchEvent(
    new CustomEvent<DesktopUpdateStatusDetail>(DESKTOP_UPDATE_STATUS_EVENT, {
      detail: { result },
    }),
  )
}

async function defaultRuntime(): Promise<DesktopUpdaterRuntime> {
  const { check } = await import('@tauri-apps/plugin-updater')
  const { relaunch } = await import('@tauri-apps/plugin-process')
  return {
    isDesktop: isTauri,
    check,
    prepareForInstall: prepareDesktopForUpdateInstall,
    relaunch,
  }
}

export async function checkForUpdatesWithRuntime(runtime: DesktopUpdaterRuntime): Promise<UpdateResult> {
  if (!runtime.isDesktop()) {
    return { available: false }
  }
  try {
    const update = await runtime.check()
    if (!update) {
      const result: UpdateResult = { available: false }
      emitDesktopUpdateStatus(result)
      return result
    }
    const result: UpdateResult = {
      available: true,
      version: update.version,
      body: update.body ?? undefined,
      date: update.date ?? undefined,
    }
    emitDesktopUpdateStatus(result)
    return result
  } catch (error) {
    logUpdaterError('check failed', error)
    const result: UpdateResult = { available: false, error: true }
    emitDesktopUpdateStatus(result)
    return result
  }
}

export async function downloadAndInstallUpdateWithRuntime(runtime: DesktopUpdaterRuntime): Promise<boolean> {
  if (!runtime.isDesktop()) {
    return false
  }
  try {
    const update = await runtime.check()
    if (!update) return false
    await runtime.prepareForInstall()
    await update.downloadAndInstall()
    await runtime.relaunch()
    return true
  } catch (error) {
    logUpdaterError('install failed', error)
    return false
  }
}

export async function checkForUpdates(): Promise<UpdateResult> {
  if (!isTauri()) {
    return { available: false }
  }
  return checkForUpdatesWithRuntime(await defaultRuntime())
}

export async function downloadAndInstallUpdate(): Promise<boolean> {
  if (!isTauri()) {
    return false
  }
  return downloadAndInstallUpdateWithRuntime(await defaultRuntime())
}

export async function getDesktopAppVersion(): Promise<string | null> {
  if (!isTauri()) {
    return null
  }
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch {
    return null
  }
}

export { isTauri } from './secureStorage'
