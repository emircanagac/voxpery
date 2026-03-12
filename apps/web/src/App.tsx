import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuthStore, restoreSecureSession } from './stores/auth'
import { authApi, isAuthError } from './api'
import { isTauri, setSecureToken } from './secureStorage'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { listen } from '@tauri-apps/api/event'
import ToastViewport from './components/ToastViewport'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionGate from './components/ConnectionGate'
import GlobalLoading from './components/GlobalLoading'
import { preloadRnnoiseWorklet } from './webrtc/rnnoise'
import { ROUTES } from './routes'

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
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)
  const [restoring, setRestoring] = useState(true)
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!(window.location.hash && /#token=([^&]+)/.test(window.location.hash))
  })
  const validatedSessionRef = useRef(false)

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
          const tokenMatch = parsed.hash && /#token=([^&]+)/.exec(parsed.hash)
          if (tokenMatch) {
            const tokenFromHash = decodeURIComponent(tokenMatch[1])
            authApi
              .getMe(tokenFromHash)
              .then((freshUser) => {
                useAuthStore.getState().setAuth(tokenFromHash, freshUser)
                setSecureToken(tokenFromHash).catch(() => {})
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

  // Web: after Google OAuth we get token in hash #token=... (cookie may not be sent). Restore session from it first.
  useEffect(() => {
    if (restoring || isTauri()) return
    if (user != null) return
    if (useAuthStore.getState().loggingOut) return
    const hash = window.location.hash
    const tokenMatch = hash && /#token=([^&]+)/.exec(hash)
    if (tokenMatch) {
      const tokenFromHash = decodeURIComponent(tokenMatch[1])
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      // Prevent the second useEffect from firing immediately by setting validation ref
      validatedSessionRef.current = true
      authApi
        .getMe(tokenFromHash)
        .then((freshUser) => {
          useAuthStore.getState().setAuth(tokenFromHash, freshUser)
        })
        .catch(() => {
            validatedSessionRef.current = false // reset on failure
        })
        .finally(() => {
          setIsGoogleRedirecting(false)
        })
      return
    }
    validatedSessionRef.current = true
    authApi
      .getMe(null)
      .then((freshUser) => {
        useAuthStore.getState().setUser(freshUser)
      })
      .catch(() => {})
  }, [restoring, user])

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
      .then(async (freshUser) => {
        // Try to restore last status
        let last: 'online' | 'dnd' | 'offline' | null = null
        try {
          const raw = localStorage.getItem('voxpery-last-status')
          if (raw === 'online' || raw === 'dnd' || raw === 'offline') {
            last = raw
          }
        } catch {
          // ignore
        }

        if (last && freshUser.status !== last) {
          try {
            const updated = await authApi.updateStatus(last, token)
            setUser(updated)
            return
          } catch {
            // fallback to fresh user
          }
        }

        setUser(freshUser)
      })
      .catch((err) => {
        if (isAuthError(err)) {
          // Token is invalid, clear session
          logout()
        }
      })
  }, [restoring, user, token, setUser, logout])

  if (restoring || isGoogleRedirecting) {
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
