/**
 * Desktop (Tauri) update check. Only runs when running inside Tauri (v1 or v2).
 * In browser, checkForUpdates is a no-op.
 */
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { isTauri } from './secureStorage'
import { prepareDesktopForUpdateInstall } from './desktopSettings'

export type UpdateResult =
  // `managedExternally`: this install is updated outside the app (a newer .flatpak file).
  | { available: false; error?: boolean; managedExternally?: boolean }
  | { available: true; version: string; body?: string; date?: string }

export type UpdateProgress =
  // `percent` is null when the server does not report the download size.
  | { phase: 'downloading'; percent: number | null }
  | { phase: 'installing' }

export const DESKTOP_UPDATE_STATUS_EVENT = 'voxpery-desktop-update-status'

export type DesktopUpdateStatusDetail = {
  result: UpdateResult
}

type DesktopUpdate = {
  version: string
  body?: string | null
  date?: string | null
  download: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
  install: () => Promise<void>
}

type DesktopUpdaterRuntime = {
  isDesktop: () => boolean
  isManagedExternally?: () => Promise<boolean>
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

let updateChannel: Promise<string> | null = null

/** Flatpak installs report the `flatpak` channel; they update by installing a newer .flatpak file. */
function isManagedExternally(): Promise<boolean> {
  updateChannel ??= import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<string>('desktop_update_channel'))
    .catch(() => 'app')
  return updateChannel.then((channel) => channel === 'flatpak')
}

async function defaultRuntime(): Promise<DesktopUpdaterRuntime> {
  const { check } = await import('@tauri-apps/plugin-updater')
  const { relaunch } = await import('@tauri-apps/plugin-process')
  return {
    isDesktop: isTauri,
    isManagedExternally,
    check,
    prepareForInstall: prepareDesktopForUpdateInstall,
    relaunch,
  }
}

export async function checkForUpdatesWithRuntime(runtime: DesktopUpdaterRuntime): Promise<UpdateResult> {
  if (!runtime.isDesktop()) {
    return { available: false }
  }
  if (await runtime.isManagedExternally?.()) {
    return { available: false, managedExternally: true }
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

export function updateProgressLabel(progress: UpdateProgress | null): string {
  if (progress?.phase === 'installing') return 'Installing…'
  if (progress?.percent != null) return `Downloading ${progress.percent}%`
  return 'Downloading…'
}

function downloadProgressReporter(onProgress?: (progress: UpdateProgress) => void) {
  let total = 0
  let received = 0
  let lastPercent: number | null = null
  return (event: DownloadEvent) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0
      onProgress?.({ phase: 'downloading', percent: total ? 0 : null })
    } else if (event.event === 'Progress' && total) {
      received += event.data.chunkLength
      const percent = Math.min(100, Math.floor((received * 100) / total))
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress?.({ phase: 'downloading', percent })
      }
    }
  }
}

export async function downloadAndInstallUpdateWithRuntime(
  runtime: DesktopUpdaterRuntime,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<boolean> {
  if (!runtime.isDesktop() || await runtime.isManagedExternally?.()) {
    return false
  }
  try {
    const update = await runtime.check()
    if (!update) return false
    // Preparing lets the window close for the installer, so it waits for a finished download:
    // after a failed one, closing the window must still keep Voxpery in the tray.
    await update.download(downloadProgressReporter(onProgress))
    onProgress?.({ phase: 'installing' })
    await runtime.prepareForInstall()
    await update.install()
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

export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<boolean> {
  if (!isTauri()) {
    return false
  }
  return downloadAndInstallUpdateWithRuntime(await defaultRuntime(), onProgress)
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
