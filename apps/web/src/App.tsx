import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore, restoreSecureSession } from './stores/auth'
import { authApi, isAuthError } from './api'
import { isTauri } from './secureStorage'
import ToastViewport from './components/ToastViewport'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionGate from './components/ConnectionGate'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const AppShell = lazy(() => import('./pages/AppShell'))
const UnifiedLayout = lazy(() => import('./pages/UnifiedLayout'))

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

  // Validate session once on mount (both desktop and web)
  useEffect(() => {
    if (restoring) return
    if (!user || !token) {
      validatedSessionRef.current = false
      return
    }
    if (validatedSessionRef.current) return
    validatedSessionRef.current = true

    authApi
      .getMe(token)
      .then(async (freshUser) => {
        // Try to restore last status
        let last: 'online' | 'idle' | 'dnd' | 'offline' | null = null
        try {
          const raw = localStorage.getItem('voxpery-last-status')
          if (raw === 'online' || raw === 'idle' || raw === 'dnd' || raw === 'offline') {
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
        <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>Loading…</div>}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route path="friends" element={<UnifiedLayout />} />
              <Route path="dm" element={<UnifiedLayout />} />
              <Route path="dm/:userId" element={<UnifiedLayout />} />
              <Route path="servers" element={<UnifiedLayout />} />
              <Route path="servers/*" element={<Navigate to="/app/servers" replace />} />
              <Route index element={<Navigate to="/app/friends" replace />} />
            </Route>
            <Route path="/invite/:code" element={<InvitePage />} />
            <Route path="*" element={<Navigate to="/app/friends" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <ToastViewport />
    </ConnectionGate>
  )
}

export default App
