import { lazy, Suspense, useEffect, useRef } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { useAppStore } from './stores/app'
import { useAuthStore } from './stores/auth'
import { authApi, clearStoredDesktopOAuthVerifier, getStoredDesktopOAuthVerifier, setAuthFailureHandler } from './api'
import { isTauri, setSecureToken } from './secureStorage'
import ToastViewport from './components/ToastViewport'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionGate from './components/ConnectionGate'
import GlobalLoading from './components/GlobalLoading'
import { ROUTES } from './routes'
import { useSocketStore } from './stores/socket'
import { useFeatureStore } from './stores/features'
import { createDesktopOAuthDeepLinkHandler, registerDesktopOAuthDeepLinks } from './desktopOAuth'
import { configureObservability, reportObservabilityEvent } from './observability'

const AppShell = lazy(() => import('./pages/AppShell'))
const UnifiedLayout = lazy(() => import('./pages/UnifiedLayout'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))
const LegalPage = lazy(() => import('./pages/LegalPage'))
const LegalConsentBoundary = lazy(() => import('./components/LegalConsentBoundary'))

function RedirectDmToSocial() {
  const { userId } = useParams<{ userId?: string }>()
  return <Navigate to={ROUTES.dm} state={userId ? { openDmUserId: userId } : undefined} replace />
}

function safeRedirectPath(redirect: string | null): string | undefined {
  if (!redirect || typeof redirect !== 'string') return undefined
  const path = redirect.trim()
  if (path.startsWith('/') && !path.startsWith('//')) return path
  return undefined
}

function RedirectAuthenticatedAuthPage() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const redirectTo = safeRedirectPath(params.get('redirect'))
  return <Navigate to={redirectTo || ROUTES.home} replace />
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

function ConnectedAppShell() {
  return (
    <ConnectionGate>
      <AppShell />
    </ConnectionGate>
  )
}

function App() {
  const user = useAuthStore((s) => s.user)
  const loggingOut = useAuthStore((s) => s.loggingOut)
  const logout = useAuthStore((s) => s.logout)
  const restoreSession = useAuthStore((s) => s.restoreSession)
  const sessionState = useAuthStore((s) => s.sessionState)
  const sessionError = useAuthStore((s) => s.sessionError)
  const loadFeatures = useFeatureStore((s) => s.loadFeatures)
  const features = useFeatureStore((s) => s.features)
  const featureError = useFeatureStore((s) => s.error)
  const restoring = sessionState === 'idle' || sessionState === 'loading'
  const authFailureHandledRef = useRef(false)
  const isDesktopApp = isTauri()
  const navigate = useNavigate()
  const location = useLocation()
  const publicRoute = [
    ROUTES.landing, ROUTES.about, ROUTES.compare, ROUTES.login, ROUTES.register,
    ROUTES.forgotPassword, ROUTES.resetPassword, ROUTES.verifyEmail,
    ROUTES.terms, ROUTES.privacy, ROUTES.kvkk,
  ].some(path => path === location.pathname)

  useEffect(() => {
    void loadFeatures()
  }, [loadFeatures])

  useEffect(() => {
    if (sessionState === 'idle' && !loggingOut) void restoreSession()
  }, [sessionState, loggingOut, restoreSession])

  useEffect(() => {
    if (features) configureObservability(features.observability_enabled)
    else if (featureError) configureObservability(false)
  }, [featureError, features])

  useEffect(() => {
    if (!isDesktopApp) return
    void import('./desktopSettings')
      .then(({ bootstrapDesktopAutostartDefault }) => bootstrapDesktopAutostartDefault())
      .catch(() => {
        // UserBar still exposes the manual control if the OS startup registration fails.
      })
  }, [isDesktopApp])

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

  // Desktop: restore secure storage, then collect cold-start and runtime OAuth deep links.
  useEffect(() => {
    if (isDesktopApp) {
      let disposeDeepLinks: (() => void) | undefined
      let disposed = false
      const handleDeepLinkUrl = createDesktopOAuthDeepLinkHandler({
        getCodeVerifier: getStoredDesktopOAuthVerifier,
        clearCodeVerifier: clearStoredDesktopOAuthVerifier,
        exchangeCode: authApi.exchangeDesktopOAuthCode,
        setAuth: (authToken, authUser) => useAuthStore.getState().setAuth(authToken, authUser),
        persistToken: setSecureToken,
        navigate: (path) => navigate(path, { replace: true }),
        onError: (error) => console.error('Desktop OAuth return failed:', error),
        onObservabilityEvent: reportObservabilityEvent,
      })

      const bootstrapDesktopSession = async () => {
        const phase = useAuthStore.getState().sessionState
        if (phase === 'idle' || phase === 'loading') await restoreSession()
        if (disposed) return
        const [deepLink, event, core] = await Promise.all([
          import('@tauri-apps/plugin-deep-link'),
          import('@tauri-apps/api/event'),
          import('@tauri-apps/api/core'),
        ])
        const cleanup = await registerDesktopOAuthDeepLinks(
          {
            getCurrent: deepLink.getCurrent,
            getPending: () => core.invoke<string[]>('desktop_take_pending_deep_links'),
            onOpenUrl: deepLink.onOpenUrl,
            listenCustom: (handler) => event.listen<string>(
              'custom-deep-link',
              (received) => handler(received.payload),
            ),
          },
          handleDeepLinkUrl,
          (error) => {
            reportObservabilityEvent('desktop_oauth_setup_failed')
            console.error('Desktop deep-link setup failed:', error)
          },
        )
        if (disposed) cleanup()
        else disposeDeepLinks = cleanup
      }

      void bootstrapDesktopSession()
        .catch((error) => {
          reportObservabilityEvent('desktop_oauth_setup_failed')
          console.error('Desktop session bootstrap failed:', error)
        })

      return () => {
        disposed = true
        disposeDeepLinks?.()
      }
    }
  }, [isDesktopApp, navigate, restoreSession])

  if (restoring && !publicRoute) {
    return <GlobalLoading label="Loading…" description="Please wait." />
  }

  if (sessionState === 'error' && !publicRoute) {
    return (
      <main className="legal-consent-page">
        <section className="legal-consent-panel" aria-labelledby="session-error-title">
          <h1 id="session-error-title">Your session could not be checked</h1>
          <p>{sessionError}</p>
          <div className="legal-consent-actions">
            <button type="button" className="pw-button pw-button-primary" onClick={() => void restoreSession()}>Try again</button>
            <button type="button" className="pw-button pw-button-ghost" onClick={logout}>Log out</button>
          </div>
        </section>
      </main>
    )
  }

  if (!user || sessionState !== 'ready') {
    return (
      <Suspense fallback={<GlobalLoading label="Loading…" description="Please wait." />}>
        <Routes>
          <Route path={ROUTES.landing} element={isDesktopApp ? <Navigate to={ROUTES.login} replace /> : <AboutPage />} />
          <Route path={ROUTES.about} element={<AboutPage />} />
          <Route path={ROUTES.compare} element={<ComparePage />} />
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.register} element={<RegisterPage />} />
          <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
          <Route path={ROUTES.resetPassword} element={<ResetPasswordPage />} />
          <Route path={ROUTES.verifyEmail} element={<VerifyEmailPage />} />
          <Route path={ROUTES.privacy} element={<LegalPage />} />
          <Route path={ROUTES.terms} element={<LegalPage />} />
          <Route path={ROUTES.kvkk} element={<LegalPage />} />
          <Route path={ROUTES.invite(':code')} element={<InvitePage />} />
          <Route path="*" element={<AuthRedirect />} />
        </Routes>
        <ToastViewport />
      </Suspense>
    )
  }

  return (
    <ErrorBoundary>
      <RnnoisePreloadOnInteraction />
      <Suspense fallback={<GlobalLoading label="Loading…" description="Please wait." />}>
        <Routes>
          <Route path={ROUTES.privacy} element={<LegalPage />} />
          <Route path={ROUTES.terms} element={<LegalPage />} />
          <Route path={ROUTES.kvkk} element={<LegalPage />} />
          <Route path={ROUTES.about} element={<AboutPage />} />
          <Route path={ROUTES.compare} element={<ComparePage />} />
          <Route element={<LegalConsentBoundary />}>
            <Route path={ROUTES.landing} element={<Navigate to={ROUTES.home} replace />} />
            <Route element={<ConnectedAppShell />}>
              {/* UnifiedLayout wraps /social, /social/dm and /servers so it doesn't unmount on switch */}
              <Route element={<UnifiedLayout />}>
                <Route path={ROUTES.home} element={null} />
                <Route path={ROUTES.dm} element={null} />
                <Route path={ROUTES.servers} element={null} />
                <Route path={`${ROUTES.servers}/*`} element={<Navigate to={ROUTES.servers} replace />} />
              </Route>
              <Route path={`${ROUTES.dm}/:userId`} element={<RedirectDmToSocial />} />
            </Route>
            <Route path={ROUTES.login} element={<RedirectAuthenticatedAuthPage />} />
            <Route path={ROUTES.register} element={<RedirectAuthenticatedAuthPage />} />
            <Route path={ROUTES.verifyEmail} element={<VerifyEmailPage />} />
            <Route path={ROUTES.invite(':code')} element={<InvitePage />} />
            <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
          </Route>
        </Routes>
      </Suspense>
      <ToastViewport />
    </ErrorBoundary>
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
      void import('./webrtc/rnnoise')
        .then(({ preloadRnnoiseWorklet }) => preloadRnnoiseWorklet())
        .catch(() => {})
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
