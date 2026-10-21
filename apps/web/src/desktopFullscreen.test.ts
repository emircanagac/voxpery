import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncDesktopWindowFullscreen } from './desktopFullscreen'

function desktopWindow({ fullscreen = false, maximized = false } = {}) {
  const calls: string[] = []
  const state = { fullscreen, maximized }
  return {
    calls,
    isFullscreen: vi.fn(async () => state.fullscreen),
    isMaximized: vi.fn(async () => state.maximized),
    setFullscreen: vi.fn(async (value: boolean) => { calls.push(`fullscreen:${value}`); state.fullscreen = value }),
    maximize: vi.fn(async () => { calls.push('maximize'); state.maximized = true }),
    unmaximize: vi.fn(async () => { calls.push('unmaximize'); state.maximized = false }),
  }
}

describe('syncDesktopWindowFullscreen', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('does nothing in the browser', async () => {
    const load = vi.fn(async () => desktopWindow())
    await syncDesktopWindowFullscreen(true, load)
    expect(load).not.toHaveBeenCalled()
  })

  it('makes the desktop window follow element fullscreen', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const win = desktopWindow()
    await syncDesktopWindowFullscreen(true, async () => win)
    await syncDesktopWindowFullscreen(false, async () => win)
    expect(win.calls).toEqual(['fullscreen:true', 'fullscreen:false'])

    const already = desktopWindow({ fullscreen: true })
    await syncDesktopWindowFullscreen(true, async () => already)
    expect(already.setFullscreen).not.toHaveBeenCalled()
  })

  it('restores a maximized window before fullscreen and maximizes it again afterwards', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const win = desktopWindow({ maximized: true })
    await syncDesktopWindowFullscreen(true, async () => win)
    expect(win.calls).toEqual(['unmaximize', 'fullscreen:true'])
    await syncDesktopWindowFullscreen(false, async () => win)
    expect(win.calls).toEqual(['unmaximize', 'fullscreen:true', 'fullscreen:false', 'maximize'])
  })

  it('ignores runtime refusals', async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} })
    const win = desktopWindow()
    win.setFullscreen.mockRejectedValueOnce(new Error('denied'))
    await expect(syncDesktopWindowFullscreen(true, async () => win)).resolves.toBeUndefined()
  })
})
