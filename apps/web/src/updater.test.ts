import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_UPDATE_STATUS_EVENT,
  checkForUpdatesWithRuntime,
  downloadAndInstallUpdateWithRuntime,
  type UpdateResult,
} from './updater'

function createRuntime(options?: {
  isDesktop?: boolean
  update?: {
    version?: string
    body?: string | null
    date?: string | null
    downloadAndInstall?: () => Promise<void>
  } | null
  checkRejects?: boolean
}) {
  const downloadAndInstall = vi.fn(options?.update?.downloadAndInstall ?? (() => Promise.resolve()))
  const update =
    options?.update === undefined
      ? null
      : options.update && {
          version: options.update.version ?? '0.2.0',
          body: options.update.body,
          date: options.update.date,
          downloadAndInstall,
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
    downloadAndInstall,
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

  it('prepares the desktop runtime before installing and relaunching', async () => {
    const calls: string[] = []
    const { runtime, downloadAndInstall } = createRuntime({
      update: {
        downloadAndInstall: async () => {
          calls.push('downloadAndInstall')
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

    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['prepare', 'downloadAndInstall', 'relaunch'])
  })

  it('returns false without install side effects when no update exists', async () => {
    const { runtime, downloadAndInstall } = createRuntime({ update: null })

    await expect(downloadAndInstallUpdateWithRuntime(runtime)).resolves.toBe(false)

    expect(runtime.prepareForInstall).not.toHaveBeenCalled()
    expect(downloadAndInstall).not.toHaveBeenCalled()
    expect(runtime.relaunch).not.toHaveBeenCalled()
  })

  it('handles updater errors without throwing', async () => {
    const { runtime } = createRuntime({ checkRejects: true })

    await expect(checkForUpdatesWithRuntime(runtime)).resolves.toEqual({ available: false, error: true })
    await expect(downloadAndInstallUpdateWithRuntime(runtime)).resolves.toBe(false)
  })
})
