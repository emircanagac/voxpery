import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncDesktopWindowFullscreen } from './desktopFullscreen'

function desktopWindow(fullscreen: boolean) {
  return { isFullscreen: vi.fn(async () => fullscreen), setFullscreen: vi.fn(async () => {}) }
}

describe('syncDesktopWindowFullscreen', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('does nothing in the browser', async () => {
    const load = vi.fn(async () => desktopWindow(false))
    await syncDesktopWindowFullscreen(true, load)
    expect(load).not.toHaveBeenCalled()
  })

  it('makes the desktop window follow element fullscreen', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const win = desktopWindow(false)
    await syncDesktopWindowFullscreen(true, async () => win)
    expect(win.setFullscreen).toHaveBeenCalledWith(true)

    const already = desktopWindow(true)
    await syncDesktopWindowFullscreen(true, async () => already)
    expect(already.setFullscreen).not.toHaveBeenCalled()
  })

  it('ignores runtime refusals', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const win = { isFullscreen: vi.fn(async () => false), setFullscreen: vi.fn(async () => { throw new Error('denied') }) }
    await expect(syncDesktopWindowFullscreen(true, async () => win)).resolves.toBeUndefined()
  })
})
