import { ROUTES } from './routes'

export function resolvePostAuthRoute(redirectTo?: string): string {
  return redirectTo || ROUTES.servers
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
  return path.startsWith('/') && !path.startsWith('//') && path !== '/'
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
