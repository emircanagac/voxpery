import { isTauri } from './secureStorage'

export type MediaPermissionKind = 'microphone' | 'camera' | 'screen'

function currentDesktopPlatform(): 'windows' | 'macos' | 'linux' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown'
  const value = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (value.includes('windows') || value.includes('win32') || value.includes('win64')) return 'windows'
  if (value.includes('macintosh') || value.includes('mac os') || value.includes('darwin')) return 'macos'
  if (value.includes('linux')) return 'linux'
  return 'unknown'
}

function mediaLabel(kind: MediaPermissionKind): string {
  if (kind === 'camera') return 'camera'
  if (kind === 'screen') return 'screen recording'
  return 'microphone'
}

export function isMediaPermissionDeniedError(err: unknown, kind: MediaPermissionKind): boolean {
  const errName = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
  const errMessage = err && typeof err === 'object' && 'message' in err
    ? String((err as { message?: unknown }).message).toLowerCase()
    : ''
  const label = mediaLabel(kind)

  return (
    errName === 'NotAllowedError'
    || errName === 'SecurityError'
    || errMessage.includes('permission denied')
    || errMessage.includes('notallowederror')
    || errMessage.includes(`${label} permission denied`)
    || ((kind === 'camera' || kind === 'screen') && errMessage.includes('securityerror'))
  )
}

export function desktopMediaPermissionRecoveryMessage(kind: MediaPermissionKind): string {
  const label = mediaLabel(kind)
  if (!isTauri()) {
    return `Permission was blocked. Allow ${label} access in your browser or system settings and try again.`
  }

  const platform = currentDesktopPlatform()
  if (platform === 'windows') {
    return `Permission was blocked. Open Windows Privacy & security settings, allow ${label} access for desktop apps, then return to Voxpery and retry.`
  }
  if (platform === 'macos') {
    return `Permission was blocked. Open macOS Privacy & Security settings, allow Voxpery to use ${label}, then restart Voxpery and retry.`
  }
  if (platform === 'linux') {
    return `Permission was blocked. Ensure xdg-desktop-portal, a portal backend, and PipeWire are installed/running, then restart Voxpery and retry ${label} access.`
  }

  return `Permission was blocked. Allow ${label} access in system settings, restart Voxpery if needed, and try again.`
}

export async function openDesktopMediaPermissionSettings(kind: MediaPermissionKind): Promise<boolean> {
  if (!isTauri()) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('desktop_open_media_permission_settings', { kind })
    return true
  } catch {
    return false
  }
}
