import type { UserPublic } from './api'
import { resolvePostAuthRoute } from './authRedirect'
import { ROUTES } from './routes'

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
  setAuth: (token: string, user: UserPublic) => void
  persistToken: (token: string) => Promise<void>
  navigate: (path: string) => void
  onError?: (error: unknown) => void
}

export interface DesktopOAuthDeepLinkSources {
  getCurrent: () => Promise<string[] | null>
  onOpenUrl: (handler: (urls: string[]) => void) => Promise<() => void>
  listenCustom: (handler: (url: string) => void) => Promise<() => void>
}

function resolveDesktopRedirect(parsed: URL): string {
  const search = new URLSearchParams(parsed.search)
  search.delete('code')
  search.delete('error')

  const suffix = search.size > 0 ? `?${search.toString()}` : ''
  const candidate = `${parsed.pathname || '/'}${suffix}${parsed.hash}`
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return resolvePostAuthRoute()
  }
  return candidate === '/' ? resolvePostAuthRoute() : resolvePostAuthRoute(candidate)
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

function oauthFailureRoute(redirectTo: string): string {
  const search = new URLSearchParams({
    error: 'oauth_failed',
    redirect: redirectTo,
  })
  return `${ROUTES.login}?${search.toString()}`
}

export function createDesktopOAuthDeepLinkHandler(deps: DesktopOAuthHandlerDependencies) {
  const handledCodes = new Set<string>()

  return async (url: string): Promise<boolean> => {
    const deepLink = parseDesktopOAuthDeepLink(url)
    if (!deepLink) return false

    if (deepLink.error || !deepLink.code) {
      deps.navigate(oauthFailureRoute(deepLink.redirectTo))
      return true
    }

    if (handledCodes.has(deepLink.code)) return true
    handledCodes.add(deepLink.code)

    const codeVerifier = deps.getCodeVerifier()
    if (!codeVerifier) {
      deps.onError?.(new Error('Desktop OAuth code verifier is missing'))
      deps.navigate(oauthFailureRoute(deepLink.redirectTo))
      return true
    }

    try {
      const auth = await deps.exchangeCode(deepLink.code, codeVerifier)
      deps.setAuth(auth.token, auth.user)
      await deps.persistToken(auth.token)
      deps.clearCodeVerifier()
      deps.navigate(deepLink.redirectTo)
    } catch (error) {
      deps.clearCodeVerifier()
      deps.onError?.(error)
      deps.navigate(oauthFailureRoute(deepLink.redirectTo))
    }

    return true
  }
}

export async function registerDesktopOAuthDeepLinks(
  sources: DesktopOAuthDeepLinkSources,
  handler: (url: string) => Promise<boolean>,
  onError: (error: unknown) => void = console.error,
): Promise<() => void> {
  const cleanup: Array<() => void> = []
  const dispatch = (url: string) => {
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
    const currentUrls = await sources.getCurrent()
    for (const url of currentUrls ?? []) {
      await handler(url)
    }
  } catch (error) {
    onError(error)
  }

  return () => {
    for (const dispose of cleanup) dispose()
  }
}
