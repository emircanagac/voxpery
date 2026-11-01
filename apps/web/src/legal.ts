import type { LegalConsentStatus } from './api/contracts'
import { ROUTES } from './routes'

/** Published hosted-service document version; must match the server's CURRENT_*_VERSION. */
export const PUBLISHED_LEGAL_VERSION = '2026-10-23'

export interface RegistrationLegalAcceptance {
  terms_accepted: boolean
  terms_version: string
  privacy_notice_acknowledged: boolean
  privacy_notice_version: string
  kvkk_notice_acknowledged: boolean
  kvkk_notice_version: string
}

/** Where a document can be read: the active server's own copy, or this app's legal page. */
export function legalDocumentHref(documents: LegalConsentStatus | null | undefined, document: 'terms' | 'privacy' | 'kvkk') {
  return documents?.[`${document}_url`] ?? ROUTES[document]
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
