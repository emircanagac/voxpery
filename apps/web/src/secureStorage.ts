/**
 * Secure token storage for desktop (Tauri). Uses OS keychain via tauri-plugin-secure-storage.
 * In browser, all functions are no-ops / return null.
 */

const AUTH_TOKEN_KEY = 'voxpery-auth-token'
// Tokens whose server-side revocation failed; retried later, never restored as a session.
const PENDING_REVOCATIONS_KEY = 'voxpery-pending-revocations'
const MAX_PENDING_REVOCATIONS = 5
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

async function getItem(key: string): Promise<string | null> {
  if (!isTauri()) return null
  return withSecureStorage(async () => {
    const invoke = await getInvoke()
    const out = await invoke('plugin:secure-storage|get_item', {
      payload: { prefixedKey: key },
    })
    if (typeof out === 'string') return out || null
    const obj = out as { data?: string | null } | null
    return obj?.data ?? null
  })
}

async function setItem(key: string, data: string): Promise<void> {
  if (!isTauri()) return
  return withSecureStorage(async () => {
    const invoke = await getInvoke()
    await invoke('plugin:secure-storage|set_item', {
      payload: { prefixedKey: key, data },
    })
  })
}

async function removeItem(key: string): Promise<void> {
  if (!isTauri()) return
  return withSecureStorage(async () => {
    const invoke = await getInvoke()
    await invoke('plugin:secure-storage|remove_item', {
      payload: { prefixedKey: key },
    })
  })
}

export const getSecureToken = (): Promise<string | null> => getItem(AUTH_TOKEN_KEY)
export const setSecureToken = (token: string): Promise<void> => setItem(AUTH_TOKEN_KEY, token)
export const removeSecureToken = (): Promise<void> => removeItem(AUTH_TOKEN_KEY)

export async function getPendingRevocations(): Promise<string[]> {
  const raw = await getItem(PENDING_REVOCATIONS_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** Keeps the newest few tokens; older ones still expire on the server. */
export async function setPendingRevocations(tokens: string[]): Promise<void> {
  const unique = [...new Set(tokens)].slice(-MAX_PENDING_REVOCATIONS)
  if (unique.length === 0) return removeItem(PENDING_REVOCATIONS_KEY)
  return setItem(PENDING_REVOCATIONS_KEY, JSON.stringify(unique))
}
