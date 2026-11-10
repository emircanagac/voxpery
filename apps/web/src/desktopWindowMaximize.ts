import type { Window as DesktopWindow } from '@tauri-apps/api/window'

/** A restored window this close to the work area still looks maximized to the user. */
const FILLS_WORK_AREA_SHARE = 0.95
/** Share of the work area a restored window takes when its normal size would fill the screen. */
const RESTORED_WORK_AREA_SHARE = 0.8
const RESTORE_SETTLE_MS = 400

export const IS_LINUX_DESKTOP = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)

function waitForResize(desktopWindow: DesktopWindow, timeoutMs: number): { settled: Promise<void>; cancel: () => void } {
  let finish = () => {}
  const settled = new Promise<void>((resolve) => {
    let done = false
    let stopListening: (() => void) | undefined
    const timer = setTimeout(() => finish(), timeoutMs)
    finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      stopListening?.()
      resolve()
    }
    desktopWindow
      .onResized(() => finish())
      .then((unlisten) => {
        if (done) unlisten()
        else stopListening = unlisten
      })
      .catch(() => finish())
  })
  return { settled, cancel: () => finish() }
}

/**
 * Linux window managers restore a window to its saved normal size. When that size does not fit
 * the work area (the 1280x800 default on a 1280x720 or 1366x768 screen), GNOME keeps the window
 * at full size and the restore button seems to do nothing, so the window then gets a smaller
 * size centred in the work area.
 */
export async function restoreLinuxDesktopWindow(
  desktopWindow: DesktopWindow,
  settleMs: number = RESTORE_SETTLE_MS,
): Promise<void> {
  const resize = waitForResize(desktopWindow, settleMs)
  try {
    await desktopWindow.unmaximize()
  } catch (error) {
    resize.cancel()
    throw error
  }
  await resize.settled
  await resizeIntoWorkArea(desktopWindow, FILLS_WORK_AREA_SHARE)
}

/**
 * On start, a window that `tauri-plugin-window-state` restored to a saved normal size larger
 * than the work area (saved on a bigger or less scaled screen) is brought back inside it. A
 * maximized or fullscreen window, or one that fits, is left alone.
 */
export async function fitLinuxDesktopWindowToWorkArea(desktopWindow: DesktopWindow): Promise<void> {
  if (await desktopWindow.isMaximized() || await desktopWindow.isFullscreen()) return
  await resizeIntoWorkArea(desktopWindow, 1)
}

/** Resizes the window to 80% of the work area when it reaches `share` of it in either direction. */
async function resizeIntoWorkArea(desktopWindow: DesktopWindow, share: number): Promise<void> {
  const { currentMonitor, PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/window')
  const monitor = await currentMonitor()
  if (!monitor) return
  const area = monitor.workArea
  const size = await desktopWindow.outerSize()
  const reaches = share >= 1
    ? size.width > area.size.width || size.height > area.size.height
    : size.width >= area.size.width * share || size.height >= area.size.height * share
  if (!reaches) return

  const width = Math.round(area.size.width * RESTORED_WORK_AREA_SHARE)
  const height = Math.round(area.size.height * RESTORED_WORK_AREA_SHARE)
  await desktopWindow.setSize(new PhysicalSize(width, height))
  // Wayland compositors place windows themselves and may ignore this.
  await desktopWindow.setPosition(new PhysicalPosition(
    area.position.x + Math.round((area.size.width - width) / 2),
    area.position.y + Math.round((area.size.height - height) / 2),
  )).catch(() => {})
}

export async function toggleDesktopWindowMaximize(
  desktopWindow: DesktopWindow,
  isLinux: boolean = IS_LINUX_DESKTOP,
): Promise<void> {
  if (!isLinux) {
    await desktopWindow.toggleMaximize()
    return
  }
  if (await desktopWindow.isMaximized()) await restoreLinuxDesktopWindow(desktopWindow)
  else await desktopWindow.maximize()
}
