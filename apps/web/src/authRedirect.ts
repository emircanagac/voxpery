import { ROUTES } from './routes'

export function resolvePostAuthRoute(redirectTo?: string): string {
  return redirectTo || ROUTES.servers
}

function hasUnsafeRedirectCharacter(path: string): boolean {
  if (/[\s\\]/.test(path)) return true
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Returns `redirect` only when it is an in-app path on this origin. URL parsers drop tabs and
 * newlines, so a value such as `/<tab>/host` would otherwise become the protocol-relative
 * `//host` after navigation; whitespace, control characters and backslashes are rejected
 * before the resolved URL is compared with the current location.
 */
export function safeRedirectPath(redirect: string | null | undefined): string | undefined {
  if (!redirect || typeof redirect !== 'string') return undefined
  const path = redirect.trim()
  if (!path.startsWith('/') || path.startsWith('//') || hasUnsafeRedirectCharacter(path)) return undefined
  try {
    const base = new URL(window.location.href)
    const target = new URL(path, base)
    if (target.protocol !== base.protocol || target.host !== base.host) return undefined
  } catch {
    return undefined
  }
  return path
}

export function googleOAuthErrorMessage(error: string | null): string {
  switch (error) {
    case 'oauth_cancelled':
      return 'Google sign-in was cancelled. Try again when you are ready.'
    case 'oauth_failed_csrf':
      return 'Your Google sign-in session expired or could not be verified. Please try again.'
    case 'oauth_unverified_email':
      return 'Google did not verify your email address. Use a verified Google account or email/password.'
    case 'oauth_failed':
      return 'Sign in with Google failed. Try again or use email/password.'
    default:
      return ''
  }
}

const EXPIRED_SESSION_KEY = 'voxpery-expired-session-return'
const AUTH_PAGE_PATHS = ['/login', '/register', '/forgot-password', '/reset-password']

function isReturnablePath(path: string): boolean {
  return safeRedirectPath(path) === path && path !== '/'
    && !AUTH_PAGE_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}?`) || path.startsWith(`${authPath}/`))
}

/** Remembers that the server ended this session, and where the user was, for the next sign-in. */
export function rememberExpiredSession(path: string): void {
  try {
    sessionStorage.setItem(EXPIRED_SESSION_KEY, isReturnablePath(path) ? path : '')
  } catch {
    // Without storage the sign-in page simply shows no notice.
  }
}

/** Reads and clears the expired-session marker; `returnTo` is the page to reopen after sign-in. */
export function takeExpiredSession(): { returnTo?: string } | null {
  try {
    const value = sessionStorage.getItem(EXPIRED_SESSION_KEY)
    if (value === null) return null
    sessionStorage.removeItem(EXPIRED_SESSION_KEY)
    return isReturnablePath(value) ? { returnTo: value } : {}
  } catch {
    return null
  }
}
