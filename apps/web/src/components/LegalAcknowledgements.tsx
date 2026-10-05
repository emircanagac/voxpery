import { ROUTES } from '../routes'

interface Props {
  terms: boolean
  privacy: boolean
  kvkk?: boolean
  onTerms: (checked: boolean) => void
  onPrivacy: (checked: boolean) => void
  onKvkk?: (checked: boolean) => void
  disabled?: boolean
}

export default function LegalAcknowledgements({ terms, privacy, kvkk, onTerms, onPrivacy, onKvkk, disabled }: Props) {
  return (
    <div className="auth-legal-confirmations">
      <label className="auth-legal-check">
        <input type="checkbox" checked={terms} onChange={(event) => onTerms(event.target.checked)} disabled={disabled} />
        <span>I accept the <a href={ROUTES.terms} target="_blank" rel="noreferrer">Terms of Service</a>.</span>
      </label>
      <label className="auth-legal-check">
        <input type="checkbox" checked={privacy} onChange={(event) => onPrivacy(event.target.checked)} disabled={disabled} />
        <span>I have read the <a href={ROUTES.privacy} target="_blank" rel="noreferrer">Privacy Notice</a>
          {!onKvkk && <> and <a href={ROUTES.kvkk} target="_blank" rel="noreferrer">KVKK Aydinlatma Metni</a></>}.</span>
      </label>
      {onKvkk && <label className="auth-legal-check">
        <input type="checkbox" checked={!!kvkk} onChange={(event) => onKvkk(event.target.checked)} disabled={disabled} />
        <span>I have read the <a href={ROUTES.kvkk} target="_blank" rel="noreferrer">KVKK Aydinlatma Metni</a>.</span>
      </label>}
    </div>
  )
}
