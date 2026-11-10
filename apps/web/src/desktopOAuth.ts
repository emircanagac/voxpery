import type { UserPublic } from './api'
import { googleOAuthErrorMessage, resolvePostAuthRoute, safeRedirectPath } from './authRedirect'
import { ROUTES } from './routes'
import type { ObservabilityEventCode } from './observability'

const DESKTOP_OAUTH_PROTOCOL = 'voxpery:'
const DESKTOP_OAUTH_HOST = 'auth'
const DESKTOP_OAUTH_CODE_PATTERN = /^[0-9a-f]{32}$/i

interface DesktopOAuthDeepLink {
  code: string | null
  error: string | null
  redirectTo: string
}

interface DesktopOAuthHandlerDependencies {
  getCodeVerifier: () => string | null
  clearCodeVerifier: () => void
  exchangeCode: (code: string, codeVerifier: string) => Promise<{ token: string; user: UserPublic }>
  setAuth: (token: string, user: UserPublic) => Promise<void>
  navigate: (path: string) => void
  /** True while a signed-in session exists; stale return links are then ignored. */
  isAuthenticated?: () => boolean
  onError?: (error: unknown) => void
  onObservabilityEvent?: (event: ObservabilityEventCode) => void
}

export interface DesktopOAuthDeepLinkSources {
  getCurrent: () => Promise<string[] | null>
  getPending: () => Promise<string[]>
  onOpenUrl: (handler: (urls: string[]) => void) => Promise<() => void>
  listenCustom: (handler: (url: string) => void) => Promise<() => void>
}

function resolveDesktopRedirect(parsed: URL): string {
  const search = new URLSearchParams(parsed.search)
  search.delete('code')
  search.delete('error')

  const suffix = search.size > 0 ? `?${search.toString()}` : ''
  const candidate = safeRedirectPath(`${parsed.pathname || '/'}${suffix}${parsed.hash}`)
  return !candidate || candidate === '/' ? resolvePostAuthRoute() : resolvePostAuthRoute(candidate)
}

export function parseDesktopOAuthDeepLink(url: string): DesktopOAuthDeepLink | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (
    parsed.protocol !== DESKTOP_OAUTH_PROTOCOL
    || parsed.hostname !== DESKTOP_OAUTH_HOST
    || parsed.username
    || parsed.password
    || parsed.port
  ) {
    return null
  }

  const code = parsed.searchParams.get('code')?.trim() || null
  const error = parsed.searchParams.get('error')?.trim() || null
  if (code && !DESKTOP_OAUTH_CODE_PATTERN.test(code)) return null
  if (!code && !error) return null

  return {
    code,
    error,
    redirectTo: resolveDesktopRedirect(parsed),
  }
}

function oauthFailureRoute(redirectTo: string, error: string | null = null): string {
  const search = new URLSearchParams({
    error: googleOAuthErrorMessage(error) ? error! : 'oauth_failed',
    redirect: redirectTo,
  })
  return `${ROUTES.login}?${search.toString()}`
}

export function createDesktopOAuthDeepLinkHandler(deps: DesktopOAuthHandlerDependencies) {
  const handledCodes = new Set<string>()

  return async (url: string): Promise<boolean> => {
    const deepLink = parseDesktopOAuthDeepLink(url)
    if (!deepLink) return false

    // A signed-in app has no sign-in in progress: a return link that arrives now is a replay of
    // an earlier one (for example the process-wide startup link) and must not leave the app.
    const signedIn = deps.isAuthenticated?.() ?? false

    if (deepLink.error || !deepLink.code) {
      if (signedIn) return true
      deps.onObservabilityEvent?.('desktop_oauth_return_received')
      deps.onObservabilityEvent?.('desktop_oauth_return_failed')
      deps.navigate(oauthFailureRoute(deepLink.redirectTo, deepLink.error))
      return true
    }

    if (handledCodes.has(deepLink.code)) return true
    handledCodes.add(deepLink.code)

    const codeVerifier = deps.getCodeVerifier()
    if (!codeVerifier && signedIn) return true
    deps.onObservabilityEvent?.('desktop_oauth_return_received')

    if (!codeVerifier) {
      deps.onObservabilityEvent?.('desktop_oauth_return_failed')
      deps.onError?.(new Error('Desktop OAuth code verifier is missing'))
      deps.navigate(oauthFailureRoute(deepLink.redirectTo))
      return true
    }

    try {
      const auth = await deps.exchangeCode(deepLink.code, codeVerifier)
      await deps.setAuth(auth.token, auth.user)
      deps.clearCodeVerifier()
      deps.onObservabilityEvent?.('desktop_oauth_return_succeeded')
      deps.navigate(deepLink.redirectTo)
    } catch (error) {
      deps.clearCodeVerifier()
      deps.onObservabilityEvent?.('desktop_oauth_return_failed')
      deps.onError?.(error)
      deps.navigate(oauthFailureRoute(deepLink.redirectTo))
    }

    return true
  }
}

/**
 * Builds the return URL from a sign-in code (or the full `voxpery://auth` link) copied from the
 * browser page, for when the browser could not open the app.
 */
export function desktopSignInCodeUrl(input: string): string | null {
  const value = input.trim()
  if (value.toLowerCase().startsWith(`${DESKTOP_OAUTH_PROTOCOL}//`)) {
    return parseDesktopOAuthDeepLink(value)?.code ? value : null
  }
  return DESKTOP_OAUTH_CODE_PATTERN.test(value)
    ? `${DESKTOP_OAUTH_PROTOCOL}//${DESKTOP_OAUTH_HOST}/?code=${value.toLowerCase()}`
    : null
}

let signInCodeHandler: ((url: string) => Promise<boolean>) | null = null

/** The desktop app registers its deep-link handler so pasted sign-in codes take the same path. */
export function setDesktopSignInCodeHandler(handler: ((url: string) => Promise<boolean>) | null) {
  signInCodeHandler = handler
}

export async function submitDesktopSignInCode(input: string): Promise<'invalid' | 'unavailable' | 'submitted'> {
  const url = desktopSignInCodeUrl(input)
  if (!url) return 'invalid'
  if (!signInCodeHandler) return 'unavailable'
  await signInCodeHandler(url)
  return 'submitted'
}

const SEEN_DEEP_LINKS_KEY = 'voxpery-desktop-seen-deep-links'
const SEEN_DEEP_LINKS_LIMIT = 20
let seenDeepLinksFallback: string[] = []

/** Links carry one-time sign-in codes, so only a fingerprint of each is kept. */
function deepLinkFingerprint(url: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < url.length; index += 1) {
    const code = url.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function readSeenDeepLinks(): string[] {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(SEEN_DEEP_LINKS_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return seenDeepLinksFallback
  }
}

function wasDeepLinkSeen(url: string): boolean {
  return readSeenDeepLinks().includes(deepLinkFingerprint(url))
}

function rememberSeenDeepLink(url: string): void {
  const fingerprint = deepLinkFingerprint(url)
  const seen = [...readSeenDeepLinks().filter((value) => value !== fingerprint), fingerprint].slice(-SEEN_DEEP_LINKS_LIMIT)
  seenDeepLinksFallback = seen
  try {
    window.sessionStorage.setItem(SEEN_DEEP_LINKS_KEY, JSON.stringify(seen))
  } catch {
    // The in-memory list still covers this page lifetime.
  }
}

/**
 * Collects return links from every source. The deep-link plugin keeps the last link it received
 * as the process-wide "current" link and never clears it (on Linux and macOS runtime links also
 * land there), so `getCurrent` links that this webview session already saw are skipped; runtime
 * events are always delivered, because the same error link may legitimately arrive again.
 */
export async function registerDesktopOAuthDeepLinks(
  sources: DesktopOAuthDeepLinkSources,
  handler: (url: string) => Promise<boolean>,
  onError: (error: unknown) => void = console.error,
): Promise<() => void> {
  const cleanup: Array<() => void> = []
  const dispatch = (url: string) => {
    rememberSeenDeepLink(url)
    void handler(url).catch(onError)
  }

  try {
    cleanup.push(await sources.onOpenUrl((urls) => urls.forEach(dispatch)))
  } catch (error) {
    onError(error)
  }

  try {
    cleanup.push(await sources.listenCustom(dispatch))
  } catch (error) {
    onError(error)
  }

  try {
    const pendingUrls = await sources.getPending()
    for (const url of pendingUrls) {
      rememberSeenDeepLink(url)
      await handler(url)
    }
  } catch (error) {
    onError(error)
  }

  try {
    const currentUrls = await sources.getCurrent()
    for (const url of currentUrls ?? []) {
      if (wasDeepLinkSeen(url)) continue
      rememberSeenDeepLink(url)
      await handler(url)
    }
  } catch (error) {
    onError(error)
  }

  return () => {
    for (const dispose of cleanup) dispose()
  }
}
