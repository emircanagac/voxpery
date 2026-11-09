import { isTauri } from './secureStorage'

function isLinuxUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false
  const value = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  return value.includes('linux') && !value.includes('android')
}

/** Window buttons and resize borders move or minimize the window; they never take typing. */
const WINDOW_FRAME_SELECTOR = '.window-controls, .window-resize-edge'

/**
 * Linux desktop: a click inside the focused window can take X11 keyboard focus away from the
 * embedded browser, so the clicked field shows no caret and typing goes nowhere. After every
 * click, ask the desktop shell to give keyboard focus back to the page, except for clicks on
 * the window frame: refocusing right after Minimize could bring the window back.
 */
export function installLinuxDesktopKeyboardFocus(target: Window = window): () => void {
  if (!isTauri() || !isLinuxUserAgent()) return () => {}
  const refocus = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(WINDOW_FRAME_SELECTOR)) return
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('desktop_refocus_webview_keyboard'))
      .catch(() => {
        // Older desktop builds lack the command; the window focus fallback still applies.
      })
  }
  // Capture phase, so handlers that stop propagation do not skip it.
  target.addEventListener('pointerup', refocus, true)
  return () => target.removeEventListener('pointerup', refocus, true)
}
