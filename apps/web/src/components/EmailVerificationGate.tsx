import { useEffect, useRef, useState } from 'react'
import { LogOut, MailCheck } from 'lucide-react'
import { Outlet, useLocation } from 'react-router'
import { authApi, getAuthErrorMessage } from '../api'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'

/**
 * When the server requires verified email addresses, an unverified account sees this panel
 * instead of the app: the server refuses application data until the address is verified.
 * The verification link itself (`/verify-email`) stays reachable.
 */
export default function EmailVerificationGate() {
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const setUser = useAuthStore((state) => state.setUser)
  const logout = useAuthStore((state) => state.logout)
  const required = useFeatureStore((state) => state.features?.email_verification_required === true)
  const { pathname } = useLocation()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState<'resend' | 'check' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const blocked = required && user?.email_verified === false && pathname !== ROUTES.verifyEmail

  useEffect(() => {
    if (blocked) headingRef.current?.focus()
  }, [blocked])

  if (!blocked) return <Outlet />

  const resend = async () => {
    setBusy('resend')
    setError(null)
    setNotice(null)
    try {
      await authApi.requestEmailVerification(token ?? null)
      setNotice('A new verification link is on its way. Check your inbox and spam folder.')
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError).message || 'Could not send the verification email.')
    } finally {
      setBusy(null)
    }
  }

  const checkAgain = async () => {
    setBusy('check')
    setError(null)
    setNotice(null)
    try {
      const freshUser = await authApi.getMe(token ?? null)
      setUser(freshUser)
      if (!freshUser.email_verified) setNotice('Your email address is not verified yet.')
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError).message || 'Could not check your account.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="legal-consent-page">
      <section
        className="legal-consent-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-verification-title"
        aria-describedby="email-verification-description"
      >
        <div className="legal-consent-heading-icon" aria-hidden="true">
          <MailCheck size={24} />
        </div>
        <p className="legal-consent-eyebrow">Action required</p>
        <h1 id="email-verification-title" ref={headingRef} tabIndex={-1}>Verify your email address</h1>
        <p id="email-verification-description">
          This server requires a verified email address. Open the link we sent to {user?.email || 'your email address'} to continue.
        </p>

        {notice && <div className="pw-hint" role="status">{notice}</div>}
        {error && <div className="pw-hint pw-hint-warn" role="alert">{error}</div>}

        <div className="legal-consent-actions">
          <button type="button" className="pw-button pw-button-primary" onClick={() => void checkAgain()} disabled={busy !== null}>
            {busy === 'check' ? 'Checking...' : "I've verified it"}
          </button>
          <button type="button" className="pw-button pw-button-ghost" onClick={() => void resend()} disabled={busy !== null}>
            {busy === 'resend' ? 'Sending...' : 'Send a new link'}
          </button>
          <button type="button" className="pw-button pw-button-ghost" onClick={logout} disabled={busy !== null}>
            <LogOut aria-hidden="true" size={16} />
            Log out
          </button>
        </div>
      </section>
    </main>
  )
}
