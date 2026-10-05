import { useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { Outlet } from 'react-router'
import {
  authApi,
  getAuthErrorMessage,
  LEGAL_CONSENT_REQUIRED_EVENT,
  type LegalConsentStatus,
} from '../api'
import { useAuthStore } from '../stores/auth'
import GlobalLoading from './GlobalLoading'
import LegalAcknowledgements from './LegalAcknowledgements'

export default function LegalConsentBoundary() {
  const identity = useAuthStore((state) => `${state.user?.id}:${state.token}`)
  return <LegalConsentGate key={identity} />
}

function LegalConsentGate() {
  const token = useAuthStore((state) => state.token)
  const userId = useAuthStore((state) => state.user?.id)
  const logout = useAuthStore((state) => state.logout)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const initialStatus = useRef(useAuthStore.getState().legalConsent).current
  const [status, setStatus] = useState<LegalConsentStatus | null>(initialStatus)
  const [loading, setLoading] = useState(!initialStatus)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const requestId = useRef(0)
  const currentDocuments = useRef('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false)
  const [kvkkAcknowledged, setKvkkAcknowledged] = useState(false)

  const loadStatus = useCallback(async () => {
    const request = ++requestId.current
    if (userId) useAuthStore.getState().setLegalConsent(null, userId, token)
    setLoading(true)
    setError(null)
    setSubmitError(null)
    setSubmitting(false)
    try {
      const next = await authApi.getLegalConsent(token)
      if (request !== requestId.current) return
      const versions = `${next.current_terms_version}:${next.current_privacy_notice_version}:${next.current_kvkk_notice_version}`
      if (versions !== currentDocuments.current) {
        setTermsAccepted(false)
        setPrivacyAcknowledged(false)
        setKvkkAcknowledged(false)
        currentDocuments.current = versions
      }
      setStatus(next)
      if (userId) useAuthStore.getState().setLegalConsent(next, userId, token)
    } catch (requestError) {
      if (request === requestId.current) setError(getAuthErrorMessage(requestError).message)
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [token, userId])

  useEffect(() => {
    if (!initialStatus) void loadStatus()
    const requests = requestId
    return () => { requests.current++ }
  }, [loadStatus, userId, initialStatus])

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
    if (!termsAccepted || !privacyAcknowledged || !kvkkAcknowledged || submitting) return
    const request = requestId.current
    setSubmitting(true)
    setSubmitError(null)
    try {
      const nextStatus = await authApi.acknowledgeLegalConsent({
        terms_accepted: true,
        terms_version: status.current_terms_version,
        privacy_notice_acknowledged: true,
        privacy_notice_version: status.current_privacy_notice_version,
        kvkk_notice_acknowledged: true,
        kvkk_notice_version: status.current_kvkk_notice_version,
      }, token)
      if (request === requestId.current) {
        setStatus(nextStatus)
        if (userId) useAuthStore.getState().setLegalConsent(nextStatus, userId, token)
      }
    } catch (requestError) {
      if (request === requestId.current) setSubmitError(getAuthErrorMessage(requestError).message)
    } finally {
      if (request === requestId.current) setSubmitting(false)
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

        <LegalAcknowledgements terms={termsAccepted} privacy={privacyAcknowledged} kvkk={kvkkAcknowledged}
          onTerms={setTermsAccepted} onPrivacy={setPrivacyAcknowledged} onKvkk={setKvkkAcknowledged} disabled={submitting} />

        {submitError && <div className="pw-hint pw-hint-warn" role="alert">{submitError}</div>}

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
