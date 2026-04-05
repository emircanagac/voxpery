import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAppStore } from './stores/app'
import { useAuthStore, restoreSecureSession } from './stores/auth'
import { authApi, clearStoredDesktopOAuthVerifier, getStoredDesktopOAuthVerifier, isAuthError, setAuthFailureHandler } from './api'
import { isTauri, setSecureToken } from './secureStorage'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { listen } from '@tauri-apps/api/event'
import ToastViewport from './components/ToastViewport'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionGate from './components/ConnectionGate'
import GlobalLoading from './components/GlobalLoading'
import { preloadRnnoiseWorklet } from './webrtc/rnnoise'
import { ROUTES } from './routes'
import { useSocketStore } from './stores/socket'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const AppShell = lazy(() => import('./pages/AppShell'))
const UnifiedLayout = lazy(() => import('./pages/UnifiedLayout'))

function RedirectDmToSocial() {
  const { userId } = useParams<{ userId?: string }>()
  return <Navigate to={ROUTES.home} state={userId ? { openDmUserId: userId } : undefined} replace />
}

function AuthRedirect() {
  const location = window.location
  const currentPath = location.pathname + location.search + location.hash
  if (
    currentPath === '/' || 
    currentPath.startsWith('/login') || 
    currentPath.startsWith('/register') || 
    currentPath.startsWith('/forgot-password') || 
    currentPath.startsWith('/reset-password')
  ) {
    return <Navigate to={ROUTES.login} replace />
  }
  return <Navigate to={`${ROUTES.login}?redirect=${encodeURIComponent(currentPath)}`} replace />
}

function App() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const loggingOut = useAuthStore((s) => s.loggingOut)
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)
  const [restoring, setRestoring] = useState(true)
  const validatedSessionRef = useRef(false)
  const authFailureHandledRef = useRef(false)

  useEffect(() => {
    const clearExpiredSession = () => {
      if (authFailureHandledRef.current) return
      authFailureHandledRef.current = true
      useSocketStore.getState().disconnect()
      useAppStore.getState().resetSessionState()
      useAuthStore.getState().clearSession()
    }

    setAuthFailureHandler(clearExpiredSession)
    return () => setAuthFailureHandler(null)
  }, [])

  useEffect(() => {
    if (user) {
      authFailureHandledRef.current = false
    }
  }, [user])

  useEffect(() => {
    if (restoring || user) return
    useSocketStore.getState().disconnect()
    useAppStore.getState().resetSessionState()
  }, [restoring, user])

  // Desktop: restore from secure storage. Web: zustand persist handles restoration.
  useEffect(() => {
    if (isTauri()) {
      restoreSecureSession().finally(() => setRestoring(false))

      // Listen for deep links (Google OAuth callback)
      let unlisten: (() => void) | undefined
      let unlistenCustom: (() => void) | undefined

      const handleDeepLinkUrl = (url: string) => {
        try {
          const parsed = new URL(url)
          const code = parsed.searchParams.get('code')
          if (code) {
            const codeVerifier = getStoredDesktopOAuthVerifier()
            if (!codeVerifier) {
              console.error('Missing desktop OAuth code verifier; restart login flow.')
              return
            }
            authApi
              .exchangeDesktopOAuthCode(code, codeVerifier)
              .then((auth) => {
                useAuthStore.getState().setAuth(auth.token, auth.user)
                setSecureToken(auth.token).catch(() => {})
                clearStoredDesktopOAuthVerifier()
              })
              .catch((err) => {
                 console.error("Deep link auth error:", err)
              })
          }
        } catch (err) {
          console.error("Deep link URL parse error:", err)
        }
      }

      onOpenUrl((urls) => {
        for (const url of urls) {
          handleDeepLinkUrl(url)
        }
      })
        .then((fn) => { unlisten = fn })
        .catch(console.error)

      listen<string>('custom-deep-link', (event: { payload: string }) => {
        handleDeepLinkUrl(event.payload)
      })
        .then((fn: () => void) => { unlistenCustom = fn })
        .catch(console.error)

      return () => {
        if (unlisten) unlisten()
        if (unlistenCustom) unlistenCustom()
      }
    } else {
      // Web: wait for zustand persist to rehydrate, then mark as ready
      queueMicrotask(() => setRestoring(false))
    }
  }, [])

  // Web: cookie-based session restore/validation.
  useEffect(() => {
    if (restoring || isTauri()) return
    // Always validate web cookie session on startup, even when user is restored from localStorage.
    // Otherwise stale user state can show "logged in" while all protected data requests fail.
    if (validatedSessionRef.current) return
    if (loggingOut) return
    validatedSessionRef.current = true
    authApi
      .getMe(null)
      .then((freshUser) => {
        useAuthStore.getState().setUser(freshUser)
      })
      .catch((err) => {
        // Expired/invalid cookie: clear stale persisted user so UI returns to login.
        if (isAuthError(err)) {
          authFailureHandledRef.current = false
          logout()
        } else {
          // transient network/server issue: allow a later retry
          validatedSessionRef.current = false
        }
      })
  }, [restoring, loggingOut, logout])

  // Validate session once on mount (both desktop and web)
  useEffect(() => {
    if (restoring) return
    if (!user || !token) {
      if (!isTauri()) return
      validatedSessionRef.current = false
      return
    }
    if (validatedSessionRef.current) return
    validatedSessionRef.current = true

    authApi
      .getMe(token)
      .then((freshUser) => {
        setUser(freshUser)
      })
      .catch((err) => {
        if (isAuthError(err)) {
          // Token is invalid, clear session
          authFailureHandledRef.current = false
          logout()
        }
      })
  }, [restoring, user, token, setUser, logout])

  if (restoring) {
    return <GlobalLoading label="Loading…" description="Please wait." />
  }

  if (!user) {
    return (
      <ConnectionGate>
        <Suspense fallback={<GlobalLoading label="Loading…" description="Please wait." />}>
          <Routes>
            <Route path={ROUTES.login} element={<LoginPage />} />
            <Route path={ROUTES.register} element={<RegisterPage />} />
            <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
            <Route path={ROUTES.resetPassword} element={<ResetPasswordPage />} />
            <Route path={ROUTES.invite(':code')} element={<InvitePage />} />
            <Route path="*" element={<AuthRedirect />} />
          </Routes>
        </Suspense>
        <ToastViewport />
      </ConnectionGate>
    )
  }

  return (
    <ConnectionGate>
      <ErrorBoundary>
        <RnnoisePreloadOnInteraction />
        <Suspense fallback={<GlobalLoading label="Loading…" description="Please wait." />}>
          <Routes>
            <Route element={<AppShell />}>
              {/* UnifiedLayout wraps both / and /servers so it doesn't unmount on switch */}
              <Route element={<UnifiedLayout />}>
                <Route path={ROUTES.home} element={null} />
                <Route path={ROUTES.servers} element={null} />
                <Route path={`${ROUTES.servers}/*`} element={<Navigate to={ROUTES.servers} replace />} />
              </Route>
              <Route path={ROUTES.dm} element={<RedirectDmToSocial />} />
              <Route path={`${ROUTES.dm}/:userId`} element={<RedirectDmToSocial />} />
            </Route>
            <Route path={ROUTES.invite(':code')} element={<InvitePage />} />
            <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <ToastViewport />
    </ConnectionGate>
  )
}

/** Preload RNNoise worklet on first user interaction to shorten first voice join. */
function RnnoisePreloadOnInteraction() {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    const run = () => {
      if (done.current) return
      done.current = true
      preloadRnnoiseWorklet()
      document.removeEventListener('click', run)
      document.removeEventListener('keydown', run)
    }
    document.addEventListener('click', run, { once: true, capture: true })
    document.addEventListener('keydown', run, { once: true, capture: true })
    return () => {
      document.removeEventListener('click', run)
      document.removeEventListener('keydown', run)
    }
  }, [])
  return null
}

export default App
