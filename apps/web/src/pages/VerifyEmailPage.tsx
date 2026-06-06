import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { authApi, getAuthErrorMessage } from '../api'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'

export default function VerifyEmailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)
  const setUser = useAuthStore((s) => s.setUser)
  const verifyToken = useMemo(() => new URLSearchParams(location.search).get('token')?.trim() ?? '', [location.search])
  const authRef = useRef({ token, user })
  const submittedVerificationTokensRef = useRef(new Set<string>())
  const [verificationState, setVerificationState] = useState<{
    verifyToken: string
    status: 'success' | 'error'
    message: string
  } | null>(null)
  const activeVerificationState = verificationState?.verifyToken === verifyToken ? verificationState : null
  const status = !verifyToken ? 'error' : activeVerificationState?.status ?? 'loading'
  const message = !verifyToken
    ? 'This verification link is missing a token.'
    : activeVerificationState?.message ?? 'Verifying your email address...'

  useEffect(() => {
    authRef.current = { token, user }
  }, [token, user])

  useEffect(() => {
    if (!verifyToken) return
    if (submittedVerificationTokensRef.current.has(verifyToken)) return
    submittedVerificationTokensRef.current.add(verifyToken)

    let cancelled = false
    let redirectTimeout: number | null = null
    const { token: currentToken, user: currentUser } = authRef.current
    authApi.confirmEmailVerification(currentToken ?? null, verifyToken)
      .then(async (result) => {
        if (cancelled) return
        if (currentUser) {
          try {
            const freshUser = await authApi.getMe(currentToken ?? null)
            if (cancelled) return
            if (currentToken) setAuth(currentToken, freshUser)
            else setUser(freshUser)
          } catch {
            // Keep success UX even if session refresh fails transiently.
          }
        }
        setVerificationState({
          verifyToken,
          status: 'success',
          message: result.message || 'Your email address has been verified.',
        })
        redirectTimeout = window.setTimeout(() => {
          navigate(currentToken && currentUser ? ROUTES.home : ROUTES.login, { replace: true })
        }, 1200)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setVerificationState({
          verifyToken,
          status: 'error',
          message: getAuthErrorMessage(err).message || 'Could not verify this email address.',
        })
      })

    return () => {
      cancelled = true
      if (redirectTimeout != null) window.clearTimeout(redirectTimeout)
    }
  }, [navigate, setAuth, setUser, verifyToken])

  return (
    <main className="auth-page">
      <section className="auth-card" style={{ maxWidth: 520 }}>
        <h1>Verify Email</h1>
        <p>{message}</p>
        {status === 'success' && (
          <p className="auth-success">
            {token && user ? 'Redirecting you back to Voxpery...' : 'Redirecting you to login...'}
          </p>
        )}
        {status === 'error' && (
          <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
            <Link className="btn btn-primary" to={ROUTES.login}>
              Go to login
            </Link>
            <Link className="btn btn-secondary" to={ROUTES.home}>
              Back to app
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
