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
 * the runtime makes the window fullscreen by itself when an element enters fullscreen, but a
 * maximized window stays maximized, so the webview keeps the work-area size and a taskbar-high
 * black band remains. A maximized window therefore leaves fullscreen, is restored and enters
 * fullscreen again, and is maximized again when fullscreen ends, whoever left it.
 */
export async function syncDesktopWindowFullscreen(
  active: boolean,
  loadWindow: () => Promise<DesktopWindow> = loadDesktopWindow,
): Promise<void> {
  if (!isTauri()) return
  try {
    const desktopWindow = await loadWindow()
    const fullscreen = await desktopWindow.isFullscreen()
    if (active) {
      if (await desktopWindow.isMaximized()) {
        restoreMaximizedAfterFullscreen = true
        if (fullscreen) await desktopWindow.setFullscreen(false)
        await desktopWindow.unmaximize()
        await desktopWindow.setFullscreen(true)
      } else if (!fullscreen) {
        await desktopWindow.setFullscreen(true)
      }
      return
    }
    if (fullscreen) await desktopWindow.setFullscreen(false)
    if (restoreMaximizedAfterFullscreen) {
      restoreMaximizedAfterFullscreen = false
      await desktopWindow.maximize()
    }
  } catch {
    // The window keeps its current state if the runtime rejects the request.
  }
}
