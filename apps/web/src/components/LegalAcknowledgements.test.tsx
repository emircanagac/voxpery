import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LegalConsentStatus } from '../api/contracts'
import LegalAcknowledgements from './LegalAcknowledgements'

const documents: LegalConsentStatus = {
  required: true,
  current_terms_version: 'own-1',
  current_privacy_notice_version: 'own-1',
  current_kvkk_notice_version: 'own-1',
  operator: 'self_hosted',
  terms_url: 'https://chat.example.org/terms',
  privacy_url: null,
}

function renderLinks(status?: LegalConsentStatus) {
  render(<LegalAcknowledgements documents={status} terms={false} privacy={false} onTerms={() => {}} onPrivacy={() => {}} />)
}

describe('legal acknowledgement links', () => {
  it('opens the legal pages of this app by default', () => {
    renderLinks()
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy')
  })

  it('keeps the legal page of this app for an address that is not a web address', () => {
    renderLinks({ ...documents, terms_url: 'javascript:alert(1)' })
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
  })

  it('opens the documents a self-hosted operator published', () => {
    renderLinks(documents)
    expect(screen.getByRole('link', { name: 'Terms of Service' }))
      .toHaveAttribute('href', 'https://chat.example.org/terms')
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy')
  })
})
