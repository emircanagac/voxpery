/**
 * Open a URL in the system default browser (desktop) or new tab (web).
 */
import { isTauri } from './secureStorage'

export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    window.open(trimmed, '_blank', 'noopener,noreferrer')
    return
  }
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(trimmed)
    } catch {
      window.open(trimmed, '_blank', 'noopener,noreferrer')
    }
  } else {
    window.open(trimmed, '_blank', 'noopener,noreferrer')
  }
}
