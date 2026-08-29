export const CURRENT_TERMS_VERSION = '2026-08-23'
export const CURRENT_PRIVACY_NOTICE_VERSION = '2026-08-23'
export const CURRENT_KVKK_NOTICE_VERSION = '2026-08-23'

export interface RegistrationLegalAcceptance {
  terms_accepted: boolean
  terms_version: string
  privacy_notice_acknowledged: boolean
  privacy_notice_version: string
  kvkk_notice_acknowledged: boolean
  kvkk_notice_version: string
}

export function currentLegalAcceptance(): RegistrationLegalAcceptance {
  return {
    terms_accepted: true,
    terms_version: CURRENT_TERMS_VERSION,
    privacy_notice_acknowledged: true,
    privacy_notice_version: CURRENT_PRIVACY_NOTICE_VERSION,
    kvkk_notice_acknowledged: true,
    kvkk_notice_version: CURRENT_KVKK_NOTICE_VERSION,
  }
}
