import type { LegalConsentStatus } from './api/contracts'

export interface RegistrationLegalAcceptance {
  terms_accepted: boolean
  terms_version: string
  privacy_notice_acknowledged: boolean
  privacy_notice_version: string
  kvkk_notice_acknowledged: boolean
  kvkk_notice_version: string
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
