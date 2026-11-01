import type { LegalConsentStatus } from './api/contracts'
import { ROUTES } from './routes'

/** Published hosted-service document version; must match the server's HOSTED_*_VERSION. */
export const PUBLISHED_LEGAL_VERSION = '2026-11-01'

export interface RegistrationLegalAcceptance {
  terms_accepted: boolean
  terms_version: string
  privacy_notice_acknowledged: boolean
  privacy_notice_version: string
  kvkk_notice_acknowledged: boolean
  kvkk_notice_version: string
}

/** Web addresses only: in the desktop app these values come from a server the app does not vouch for. */
export function legalWebUrl(url: string | null | undefined) {
  return url && /^https?:\/\//i.test(url) ? url : null
}

/** Not voxpery.com. A desktop app on a custom server knows that even if an older server does not say so. */
export function isSelfHostedServer(documents: LegalConsentStatus | null | undefined) {
  return documents?.operator === 'self_hosted' || !!window.__VOXPERY_DESKTOP_SERVER__?.apiBase
}

/** Where a document can be read: the active server's own copy, or this app's legal page. */
export function legalDocumentHref(documents: LegalConsentStatus | null | undefined, document: 'terms' | 'privacy' | 'kvkk') {
  return legalWebUrl(documents?.[`${document}_url`]) ?? ROUTES[document]
}

export function currentLegalAcceptance(documents: LegalConsentStatus): RegistrationLegalAcceptance {
  return {
    terms_accepted: true,
    terms_version: documents.current_terms_version,
    privacy_notice_acknowledged: true,
    privacy_notice_version: documents.current_privacy_notice_version,
    kvkk_notice_acknowledged: true,
    kvkk_notice_version: documents.current_kvkk_notice_version,
  }
}
