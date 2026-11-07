import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_UPDATE_STATUS_EVENT,
  checkForUpdatesWithRuntime,
  downloadAndInstallUpdateWithRuntime,
  updateProgressLabel,
  type UpdateProgress,
  type UpdateResult,
} from './updater'

function createRuntime(options?: {
  isDesktop?: boolean
  update?: {
    version?: string
    body?: string | null
    date?: string | null
    download?: (onEvent?: (event: DownloadEvent) => void) => Promise<void>
    install?: () => Promise<void>
  } | null
  checkRejects?: boolean
}) {
  const download = vi.fn(options?.update?.download ?? (() => Promise.resolve()))
  const install = vi.fn(options?.update?.install ?? (() => Promise.resolve()))
  const update =
    options?.update === undefined
      ? null
      : options.update && {
          version: options.update.version ?? '0.2.0',
          body: options.update.body,
          date: options.update.date,
          download,
          install,
        }
  const check = options?.checkRejects
    ? vi.fn<() => Promise<typeof update>>(() => Promise.reject(new Error('updater failed')))
    : vi.fn<() => Promise<typeof update>>(() => Promise.resolve(update))
  return {
    runtime: {
      isDesktop: () => options?.isDesktop ?? true,
      check,
      prepareForInstall: vi.fn(() => Promise.resolve()),
      relaunch: vi.fn(() => Promise.resolve()),
    },
    check,
    download,
    install,
  }
}

function listenForUpdateStatus() {
  const events: UpdateResult[] = []
  const listener = (event: Event) => {
    events.push((event as CustomEvent<{ result: UpdateResult }>).detail.result)
  }
  window.addEventListener(DESKTOP_UPDATE_STATUS_EVENT, listener)
  return {
    events,
    stop: () => window.removeEventListener(DESKTOP_UPDATE_STATUS_EVENT, listener),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('desktop updater', () => {
  it('leaves Flatpak installs to their .flatpak file without checking or installing', async () => {
    const { runtime, check, download, install } = createRuntime({ update: { version: '0.5.0' } })
    const flatpakRuntime = { ...runtime, externalUpdateChannel: () => Promise.resolve('flatpak' as const) }
    const status = listenForUpdateStatus()

    await expect(checkForUpdatesWithRuntime(flatpakRuntime)).resolves.toEqual({ available: false, managedExternally: true, managedBy: 'flatpak' })
    await expect(downloadAndInstallUpdateWithRuntime(flatpakRuntime)).resolves.toBe(false)

    expect(check).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(flatpakRuntime.relaunch).not.toHaveBeenCalled()
    expect(status.events).toEqual([])
    status.stop()
  })

  it('leaves the AUR package to the system package manager', async () => {
    const { runtime, check, download } = createRuntime({ update: { version: '0.5.0' } })
    const pacmanRuntime = { ...runtime, externalUpdateChannel: () => Promise.resolve('pacman' as const) }

    await expect(checkForUpdatesWithRuntime(pacmanRuntime)).resolves.toEqual({ available: false, managedExternally: true, managedBy: 'pacman' })
    await expect(downloadAndInstallUpdateWithRuntime(pacmanRuntime)).resolves.toBe(false)

    expect(check).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('does not check for updates outside desktop runtime', async () => {
    const { runtime, check } = createRuntime({ isDesktop: false })

    await expect(checkForUpdatesWithRuntime(runtime)).resolves.toEqual({ available: false })
    expect(check).not.toHaveBeenCalled()
  })

  it('emits unavailable status when no update exists', async () => {
    const { runtime } = createRuntime({ update: null })
    const status = listenForUpdateStatus()

    await expect(checkForUpdatesWithRuntime(runtime)).resolves.toEqual({ available: false })

    expect(status.events).toEqual([{ available: false }])
    status.stop()
  })

  it('emits update metadata when an update is available', async () => {
    const { runtime } = createRuntime({
      update: { version: '0.2.0', body: 'Release notes', date: '2026-04-26' },
    })
    const status = listenForUpdateStatus()

    await expect(checkForUpdatesWithRuntime(runtime)).resolves.toEqual({
      available: true,
      version: '0.2.0',
      body: 'Release notes',
      date: '2026-04-26',
    })

    expect(status.events).toEqual([
      {
        available: true,
        version: '0.2.0',
        body: 'Release notes',
        date: '2026-04-26',
      },
    ])
    status.stop()
  })

  it('prepares the desktop runtime after the download, before installing and relaunching', async () => {
    const calls: string[] = []
    const { runtime, download, install } = createRuntime({
      update: {
        download: async () => {
          calls.push('download')
        },
        install: async () => {
          calls.push('install')
        },
      },
    })
    runtime.prepareForInstall = vi.fn(async () => {
      calls.push('prepare')
    })
    runtime.relaunch = vi.fn(async () => {
      calls.push('relaunch')
    })

    await expect(downloadAndInstallUpdateWithRuntime(runtime)).resolves.toBe(true)

    expect(download).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['download', 'prepare', 'install', 'relaunch'])
  })

  it('keeps the window behavior when the download fails', async () => {
    const { runtime, install } = createRuntime({
      update: { download: () => Promise.reject(new Error('network failed')) },
    })

    await expect(downloadAndInstallUpdateWithRuntime(runtime)).resolves.toBe(false)

    expect(runtime.prepareForInstall).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(runtime.relaunch).not.toHaveBeenCalled()
  })

  it('reports each new percentage of the download, then the install', async () => {
    const { runtime } = createRuntime({
      update: {
        download: async (onEvent) => {
          onEvent?.({ event: 'Started', data: { contentLength: 1000 } })
          onEvent?.({ event: 'Progress', data: { chunkLength: 400 } })
          onEvent?.({ event: 'Progress', data: { chunkLength: 1 } })
          onEvent?.({ event: 'Progress', data: { chunkLength: 599 } })
          onEvent?.({ event: 'Finished' })
        },
      },
    })
    const progress: UpdateProgress[] = []

    await downloadAndInstallUpdateWithRuntime(runtime, (next) => progress.push(next))

    expect(progress).toEqual([
      { phase: 'downloading', percent: 0 },
      { phase: 'downloading', percent: 40 },
      { phase: 'downloading', percent: 100 },
      { phase: 'installing' },
    ])
  })

  it('reports no percentage when the download size is unknown', async () => {
    const { runtime } = createRuntime({
      update: {
        download: async (onEvent) => {
          onEvent?.({ event: 'Started', data: {} })
          onEvent?.({ event: 'Progress', data: { chunkLength: 400 } })
        },
      },
    })
    const progress: UpdateProgress[] = []

    await downloadAndInstallUpdateWithRuntime(runtime, (next) => progress.push(next))

    expect(progress[0]).toEqual({ phase: 'downloading', percent: null })
    expect(updateProgressLabel(progress[0])).toBe('Downloading…')
    expect(updateProgressLabel({ phase: 'downloading', percent: 42 })).toBe('Downloading 42%')
    expect(updateProgressLabel({ phase: 'installing' })).toBe('Installing…')
  })

  it('returns false without install side effects when no update exists', async () => {
    const { runtime, download, install } = createRuntime({ update: null })

    await expect(downloadAndInstallUpdateWithRuntime(runtime)).resolves.toBe(false)

    expect(runtime.prepareForInstall).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
    expect(runtime.relaunch).not.toHaveBeenCalled()
  })

  it('handles updater errors without throwing', async () => {
    const { runtime } = createRuntime({ checkRejects: true })

    await expect(checkForUpdatesWithRuntime(runtime)).resolves.toEqual({ available: false, error: true })
    await expect(downloadAndInstallUpdateWithRuntime(runtime)).resolves.toBe(false)
  })
})
