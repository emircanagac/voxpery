/**
 * Secure token storage for desktop (Tauri). Uses OS keychain via tauri-plugin-secure-storage.
 * In browser, all functions are no-ops / return null.
 */

const AUTH_TOKEN_KEY = 'voxpery-auth-token'
let storageQueue: Promise<unknown> = Promise.resolve()

function withSecureStorage<T>(operation: () => Promise<T>): Promise<T> {
  // Preserve write/delete order even when a login finishes while logout is pending.
  const task = storageQueue.then(operation).catch(() => {
    throw new Error('SECURE_STORAGE_ERROR:Could not access the system keyring. Unlock it and try again.')
  })
  storageQueue = task.catch(() => {})
  return task
}

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: (cmd: string, args?: object) => Promise<unknown> } }
    __TAURI_INTERNALS__?: Record<string, unknown>
  }
}

/** Tauri v2 uses __TAURI_INTERNALS__; v1 used __TAURI__. Check both so desktop is detected. Also check protocol and userAgent as bulletproof fallbacks. */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI_IPC__' in window ||
    !!window.__TAURI__ ||
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost' ||
    navigator.userAgent.includes('Tauri')
  )
}

async function getInvoke(): Promise<(cmd: string, args?: object) => Promise<unknown>> {
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke as (cmd: string, args?: object) => Promise<unknown>
  }
  const tauri = window.__TAURI__
  const fn = tauri?.core?.invoke
  if (fn) return fn
  return () => Promise.reject(new Error('Tauri not available'))
}

export async function getSecureToken(): Promise<string | null> {
  if (!isTauri()) return null
  return withSecureStorage(async () => {
    const invoke = await getInvoke()
    const out = await invoke('plugin:secure-storage|get_item', {
      payload: { prefixedKey: AUTH_TOKEN_KEY },
    })
    if (typeof out === 'string') return out || null
    const obj = out as { data?: string | null } | null
    return obj?.data ?? null
  })
}

export async function setSecureToken(token: string): Promise<void> {
  if (!isTauri()) return
  return withSecureStorage(async () => {
    const invoke = await getInvoke()
    await invoke('plugin:secure-storage|set_item', {
      payload: { prefixedKey: AUTH_TOKEN_KEY, data: token },
    })
  })
}

export async function removeSecureToken(): Promise<void> {
  if (!isTauri()) return
  return withSecureStorage(async () => {
    const invoke = await getInvoke()
    await invoke('plugin:secure-storage|remove_item', {
      payload: { prefixedKey: AUTH_TOKEN_KEY },
    })
  })
}
