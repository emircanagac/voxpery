import type { ReactNode } from 'react'
import type { LegalConsentStatus } from '../api/contracts'
import { legalDocumentHref } from '../legal'
import { openExternalUrl } from '../openExternalUrl'
import { isTauri } from '../secureStorage'

interface Props {
  documents?: LegalConsentStatus | null
  terms: boolean
  privacy: boolean
  kvkk?: boolean
  onTerms: (checked: boolean) => void
  onPrivacy: (checked: boolean) => void
  onKvkk?: (checked: boolean) => void
  disabled?: boolean
}

function DocumentLink({ href, children }: { href: string, children: ReactNode }) {
  // A server's own document is a website, which the desktop window must not navigate to.
  const external = isTauri() && /^https?:/.test(href)
  return <a
    href={href}
    target="_blank"
    rel="noreferrer"
    onClick={external ? (event) => { event.preventDefault(); void openExternalUrl(href) } : undefined}
  >{children}</a>
}

export default function LegalAcknowledgements({ documents, terms, privacy, kvkk, onTerms, onPrivacy, onKvkk, disabled }: Props) {
  return (
    <div className="auth-legal-confirmations">
      <label className="auth-legal-check">
        <input type="checkbox" checked={terms} onChange={(event) => onTerms(event.target.checked)} disabled={disabled} />
        <span>I accept the <DocumentLink href={legalDocumentHref(documents, 'terms')}>Terms of Service</DocumentLink>.</span>
      </label>
      <label className="auth-legal-check">
        <input type="checkbox" checked={privacy} onChange={(event) => onPrivacy(event.target.checked)} disabled={disabled} />
        <span>I have read the <DocumentLink href={legalDocumentHref(documents, 'privacy')}>Privacy Notice</DocumentLink>
          {!onKvkk && <> and <DocumentLink href={legalDocumentHref(documents, 'kvkk')}>KVKK Aydınlatma Metni</DocumentLink></>}.</span>
      </label>
      {onKvkk && <label className="auth-legal-check">
        <input type="checkbox" checked={!!kvkk} onChange={(event) => onKvkk(event.target.checked)} disabled={disabled} />
        <span>I have read the <DocumentLink href={legalDocumentHref(documents, 'kvkk')}>KVKK Aydınlatma Metni</DocumentLink>.</span>
      </label>}
    </div>
  )
}
