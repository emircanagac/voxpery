import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuthStore, restoreSecureSession } from './stores/auth'
import { authApi, isAuthError } from './api'
import { isTauri } from './secureStorage'
import ToastViewport from './components/ToastViewport'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionGate from './components/ConnectionGate'
import { preloadRnnoiseWorklet } from './webrtc/rnnoise'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const AppShell = lazy(() => import('./pages/AppShell'))
const UnifiedLayout = lazy(() => import('./pages/UnifiedLayout'))

function RedirectDmToSocial() {
  const { userId } = useParams<{ userId?: string }>()
  return <Navigate to="/app/social" state={userId ? { openDmUserId: userId } : undefined} replace />
}

function App() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)
  const [restoring, setRestoring] = useState(true)
  const validatedSessionRef = useRef(false)

  // Desktop: restore from secure storage. Web: zustand persist handles restoration.
  useEffect(() => {
    if (isTauri()) {
      restoreSecureSession().finally(() => setRestoring(false))
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
      authApi
        .getMe(tokenFromHash)
        .then((freshUser) => {
          useAuthStore.getState().setAuth(tokenFromHash, freshUser)
        })
        .catch(() => {})
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

  if (restoring) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        Loading…
      </div>
    )
  }

  if (!user) {
    return (
      <ConnectionGate>
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>Loading…</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/invite/:code" element={<InvitePage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
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
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>Loading…</div>}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route path="social" element={<UnifiedLayout />} />
              <Route path="dm" element={<RedirectDmToSocial />} />
              <Route path="dm/:userId" element={<RedirectDmToSocial />} />
              <Route path="servers" element={<UnifiedLayout />} />
              <Route path="servers/*" element={<Navigate to="/app/servers" replace />} />
              <Route index element={<Navigate to="/app/social" replace />} />
            </Route>
            <Route path="/invite/:code" element={<InvitePage />} />
            <Route path="*" element={<Navigate to="/app/social" replace />} />
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
