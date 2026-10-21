import { isTauri } from './secureStorage'

type DesktopWindow = {
  isFullscreen: () => Promise<boolean>
  setFullscreen: (fullscreen: boolean) => Promise<void>
  isMaximized: () => Promise<boolean>
  maximize: () => Promise<void>
  unmaximize: () => Promise<void>
}

const loadDesktopWindow = (): Promise<DesktopWindow> =>
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow())

/** Whether the window was maximized when the current element fullscreen began. */
let restoreMaximizedAfterFullscreen = false

/**
 * Element fullscreen only fills the desktop webview, so the native window follows it. On Windows
 * a maximized frameless window keeps its client area to the work area (taskbar excluded) even in
 * fullscreen, which leaves black bars and a border around the stream; the window is therefore
 * restored first and maximized again when fullscreen ends.
 */
export async function syncDesktopWindowFullscreen(
  active: boolean,
  loadWindow: () => Promise<DesktopWindow> = loadDesktopWindow,
): Promise<void> {
  if (!isTauri()) return
  try {
    const desktopWindow = await loadWindow()
    if ((await desktopWindow.isFullscreen()) === active) return
    if (active) {
      restoreMaximizedAfterFullscreen = await desktopWindow.isMaximized()
      if (restoreMaximizedAfterFullscreen) await desktopWindow.unmaximize()
      await desktopWindow.setFullscreen(true)
      return
    }
    await desktopWindow.setFullscreen(false)
    if (restoreMaximizedAfterFullscreen) {
      restoreMaximizedAfterFullscreen = false
      await desktopWindow.maximize()
    }
  } catch {
    // The window keeps its current state if the runtime rejects the request.
  }
}
