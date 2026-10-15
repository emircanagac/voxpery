import { desktopServerApiBase } from './api/client'
import { isTauri } from './secureStorage'

const INVITE_PATH = /^\/invite\/([A-Za-z0-9_-]{1,32})\/?$/

function deriveInviteBaseFromApiEnv(): string | null {
  const apiRaw = (desktopServerApiBase() ?? import.meta.env.VITE_API_URL ?? '').trim()
  if (!apiRaw) return null

  try {
    const api = new URL(apiRaw)
    const host = api.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://localhost:5173'
    }
    if (host.startsWith('api.')) {
      return `${api.protocol}//${host.slice(4)}`
    }
    return `${api.protocol}//${api.host}`
  } catch {
    return null
  }
}

/** Public origin used to build shareable invite links. */
export function resolveInviteBaseUrl(): string {
  // Browser builds should keep current origin.
  if (typeof window !== 'undefined' && !isTauri()) {
    return window.location.origin
  }
  // Desktop builds should always return a shareable public URL, never tauri.localhost.
  return deriveInviteBaseFromApiEnv() ?? 'https://voxpery.com'
}

/**
 * Returns the invite code when `url` is an invite link of this Voxpery instance, so it can open
 * inside the app instead of a browser. Links to other hosts return null.
 */
export function parseInviteLinkCode(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.username || parsed.password) return null

  const base = new URL(resolveInviteBaseUrl())
  const allowedHosts = new Set([base.host, `www.${base.host}`])
  if (typeof window !== 'undefined' && !isTauri()) allowedHosts.add(window.location.host)
  if (!allowedHosts.has(parsed.host) || parsed.protocol !== base.protocol) return null

  return parsed.pathname.match(INVITE_PATH)?.[1] ?? null
}
