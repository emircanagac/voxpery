import { isTauri } from './secureStorage'

type DesktopWindow = {
  isFullscreen: () => Promise<boolean>
  setFullscreen: (fullscreen: boolean) => Promise<void>
}

const loadDesktopWindow = (): Promise<DesktopWindow> =>
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow())

/**
 * Element fullscreen only fills the desktop webview, so a maximized window keeps its taskbar
 * gap and border around a fullscreen stream. The native window follows the element instead.
 */
export async function syncDesktopWindowFullscreen(
  active: boolean,
  loadWindow: () => Promise<DesktopWindow> = loadDesktopWindow,
): Promise<void> {
  if (!isTauri()) return
  try {
    const desktopWindow = await loadWindow()
    if ((await desktopWindow.isFullscreen()) !== active) await desktopWindow.setFullscreen(active)
  } catch {
    // The window keeps its current state if the runtime rejects the request.
  }
}
