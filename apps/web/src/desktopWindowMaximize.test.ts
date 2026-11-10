import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Window as DesktopWindow } from '@tauri-apps/api/window'

const currentMonitor = vi.fn()

vi.mock('@tauri-apps/api/window', () => ({
  currentMonitor: () => currentMonitor(),
  PhysicalSize: class {
    width: number
    height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
  },
  PhysicalPosition: class {
    x: number
    y: number
    constructor(x: number, y: number) {
      this.x = x
      this.y = y
    }
  },
}))

import { fitLinuxDesktopWindowToWorkArea, restoreLinuxDesktopWindow, toggleDesktopWindowMaximize } from './desktopWindowMaximize'

const workArea = { position: { x: 0, y: 32 }, size: { width: 1920, height: 1048 } }

function fakeWindow(options: { maximized: boolean; restoredSize: { width: number; height: number } }) {
  let resized: (() => void) | undefined
  const desktopWindow = {
    isMaximized: vi.fn().mockResolvedValue(options.maximized),
    isFullscreen: vi.fn().mockResolvedValue(false),
    maximize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    unmaximize: vi.fn(async () => {
      resized?.()
    }),
    onResized: vi.fn(async (handler: () => void) => {
      resized = handler
      return vi.fn()
    }),
    outerSize: vi.fn().mockResolvedValue(options.restoredSize),
    setSize: vi.fn().mockResolvedValue(undefined),
    setPosition: vi.fn().mockResolvedValue(undefined),
  }
  return desktopWindow as typeof desktopWindow & DesktopWindow
}

describe('desktop window maximize', () => {
  beforeEach(() => {
    currentMonitor.mockReset()
    currentMonitor.mockResolvedValue({ workArea })
  })

  it('keeps the native toggle outside Linux', async () => {
    const desktopWindow = fakeWindow({ maximized: true, restoredSize: { width: 1920, height: 1048 } })
    await toggleDesktopWindowMaximize(desktopWindow, false)
    expect(desktopWindow.toggleMaximize).toHaveBeenCalledOnce()
    expect(desktopWindow.unmaximize).not.toHaveBeenCalled()
  })

  it('maximizes a restored Linux window', async () => {
    const desktopWindow = fakeWindow({ maximized: false, restoredSize: { width: 1200, height: 700 } })
    await toggleDesktopWindowMaximize(desktopWindow, true)
    expect(desktopWindow.maximize).toHaveBeenCalledOnce()
    expect(desktopWindow.unmaximize).not.toHaveBeenCalled()
  })

  it('keeps a restored Linux window that already fits the work area', async () => {
    const desktopWindow = fakeWindow({ maximized: true, restoredSize: { width: 1280, height: 800 } })
    await toggleDesktopWindowMaximize(desktopWindow, true)
    expect(desktopWindow.unmaximize).toHaveBeenCalledOnce()
    expect(desktopWindow.setSize).not.toHaveBeenCalled()
  })

  it('shrinks and centres a restored Linux window that still fills the work area', async () => {
    const desktopWindow = fakeWindow({ maximized: true, restoredSize: { width: 1920, height: 1048 } })
    await toggleDesktopWindowMaximize(desktopWindow, true)
    expect(desktopWindow.setSize).toHaveBeenCalledWith({ width: 1536, height: 838 })
    expect(desktopWindow.setPosition).toHaveBeenCalledWith({ x: 192, y: 137 })
  })

  it('measures the window after the restore settles even without a resize event', async () => {
    const desktopWindow = fakeWindow({ maximized: true, restoredSize: { width: 1920, height: 1048 } })
    desktopWindow.unmaximize.mockImplementation(async () => {})
    await restoreLinuxDesktopWindow(desktopWindow, 10)
    expect(desktopWindow.outerSize).toHaveBeenCalledOnce()
    expect(desktopWindow.setSize).toHaveBeenCalledOnce()
  })
})

describe('desktop window start-up fit', () => {
  beforeEach(() => {
    currentMonitor.mockReset()
    currentMonitor.mockResolvedValue({ workArea })
  })

  it('brings a window restored larger than the work area back inside it', async () => {
    const desktopWindow = fakeWindow({ maximized: false, restoredSize: { width: 2560, height: 1400 } })
    await fitLinuxDesktopWindowToWorkArea(desktopWindow)
    expect(desktopWindow.setSize).toHaveBeenCalledWith({ width: 1536, height: 838 })
  })

  it('leaves a maximized window or one that fits alone', async () => {
    const maximized = fakeWindow({ maximized: true, restoredSize: { width: 2560, height: 1400 } })
    await fitLinuxDesktopWindowToWorkArea(maximized)
    expect(maximized.setSize).not.toHaveBeenCalled()
    const fitting = fakeWindow({ maximized: false, restoredSize: { width: 1920, height: 1048 } })
    await fitLinuxDesktopWindowToWorkArea(fitting)
    expect(fitting.setSize).not.toHaveBeenCalled()
  })
})
