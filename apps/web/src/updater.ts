/**
 * Desktop (Tauri) update check. Only runs when running inside Tauri (v1 or v2).
 * In browser, checkForUpdates is a no-op.
 */
import { isTauri } from './secureStorage'

export type UpdateResult =
  | { available: false }
  | { available: true; version: string; body?: string; date?: string }

export async function checkForUpdates(): Promise<UpdateResult> {
  if (!isTauri()) {
    return { available: false }
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) return { available: false }
    return {
      available: true,
      version: update.version,
      body: update.body ?? undefined,
      date: update.date ?? undefined,
    }
  } catch {
    return { available: false }
  }
}

export async function downloadAndInstallUpdate(): Promise<boolean> {
  if (!isTauri()) {
    return false
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const { relaunch } = await import('@tauri-apps/plugin-process')
    const update = await check()
    if (!update) return false
    await update.downloadAndInstall()
    await relaunch()
    return true
  } catch {
    return false
  }
}

export { isTauri } from './secureStorage'
