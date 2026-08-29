import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, LogOut, ShieldCheck } from 'lucide-react'
import { Outlet } from 'react-router'
import {
  authApi,
  getAuthErrorMessage,
  LEGAL_CONSENT_REQUIRED_EVENT,
  type LegalConsentStatus,
} from '../api'
import { ROUTES } from '../routes'
import { useAuthStore } from '../stores/auth'
import GlobalLoading from './GlobalLoading'

export default function LegalConsentBoundary() {
  const token = useAuthStore((state) => state.token)
  const userId = useAuthStore((state) => state.user?.id)
  const logout = useAuthStore((state) => state.logout)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [status, setStatus] = useState<LegalConsentStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false)
  const [kvkkAcknowledged, setKvkkAcknowledged] = useState(false)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStatus(await authApi.getLegalConsent(token))
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus, userId])

  useEffect(() => {
    const requireFreshConsent = () => void loadStatus()
    window.addEventListener(LEGAL_CONSENT_REQUIRED_EVENT, requireFreshConsent)
    return () => window.removeEventListener(LEGAL_CONSENT_REQUIRED_EVENT, requireFreshConsent)
  }, [loadStatus])

  useEffect(() => {
    if (status?.required) headingRef.current?.focus()
  }, [status?.required])

  if (loading) {
    return <GlobalLoading label="Checking legal documents..." description="Please wait." />
  }

  if (error || !status) {
    return (
      <main className="legal-consent-page">
        <section className="legal-consent-panel" aria-labelledby="legal-consent-error-title">
          <ShieldCheck aria-hidden="true" size={28} />
          <h1 id="legal-consent-error-title">Legal documents could not be checked</h1>
          <p>{error || 'The server did not return a legal-document status.'}</p>
          <div className="legal-consent-actions">
            <button type="button" className="pw-button pw-button-primary" onClick={() => void loadStatus()}>
              Try again
            </button>
            <button type="button" className="pw-button pw-button-ghost" onClick={logout}>
              <LogOut aria-hidden="true" size={16} />
              Log out
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (!status.required) return <Outlet />

  const submit = async () => {
    if (!termsAccepted || !privacyAcknowledged || !kvkkAcknowledged) return
    setSubmitting(true)
    setError(null)
    try {
      const nextStatus = await authApi.acknowledgeLegalConsent({
        terms_accepted: true,
        terms_version: status.current_terms_version,
        privacy_notice_acknowledged: true,
        privacy_notice_version: status.current_privacy_notice_version,
        kvkk_notice_acknowledged: true,
        kvkk_notice_version: status.current_kvkk_notice_version,
      }, token)
      setStatus(nextStatus)
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="legal-consent-page">
      <section
        className="legal-consent-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-consent-title"
        aria-describedby="legal-consent-description"
      >
        <div className="legal-consent-heading-icon" aria-hidden="true">
          <ShieldCheck size={24} />
        </div>
        <p className="legal-consent-eyebrow">Action required</p>
        <h1 id="legal-consent-title" ref={headingRef} tabIndex={-1}>Review Voxpery's legal documents</h1>
        <p id="legal-consent-description">
          Please review the current documents before continuing to your account.
        </p>

        <div className="legal-consent-options">
          <label>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
            />
            <span>
              I accept the <a href={ROUTES.terms} target="_blank" rel="noreferrer">Terms of Service <ExternalLink size={13} /></a>.
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={privacyAcknowledged}
              onChange={(event) => setPrivacyAcknowledged(event.target.checked)}
            />
            <span>
              I have read the <a href={ROUTES.privacy} target="_blank" rel="noreferrer">Privacy Notice <ExternalLink size={13} /></a>.
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={kvkkAcknowledged}
              onChange={(event) => setKvkkAcknowledged(event.target.checked)}
            />
            <span>
              I have read the <a href={ROUTES.kvkk} target="_blank" rel="noreferrer">KVKK Aydinlatma Metni <ExternalLink size={13} /></a>.
            </span>
          </label>
        </div>

        {error && <div className="pw-hint pw-hint-warn" role="alert">{error}</div>}

        <div className="legal-consent-actions">
          <button
            type="button"
            className="pw-button pw-button-primary"
            disabled={!termsAccepted || !privacyAcknowledged || !kvkkAcknowledged || submitting}
            onClick={() => void submit()}
          >
            {submitting ? 'Saving...' : 'Accept and continue'}
          </button>
          <button type="button" className="pw-button pw-button-ghost" onClick={logout} disabled={submitting}>
            <LogOut aria-hidden="true" size={16} />
            Log out
          </button>
        </div>
      </section>
    </main>
  )
}
