import { describe, expect, it } from 'vitest'
import { formatAppVersionBadge } from './appVersion'

describe('formatAppVersionBadge', () => {
  it('adds a release prefix to plain semantic versions', () => {
    expect(formatAppVersionBadge('0.2.0')).toBe('v0.2.0')
    expect(formatAppVersionBadge(' 1.4.2 ')).toBe('v1.4.2')
  })

  it('keeps explicit release and candidate tags unchanged', () => {
    expect(formatAppVersionBadge('v0.2.0')).toBe('v0.2.0')
    expect(formatAppVersionBadge('sha-8da8941')).toBe('sha-8da8941')
  })

  it('shortens long immutable sha tags for the topbar badge', () => {
    expect(formatAppVersionBadge('sha-8da8941dbb1a')).toBe('sha-8da8941')
    expect(formatAppVersionBadge('sha-F49AA10BEF')).toBe('sha-F49AA10')
  })

  it('hides empty versions', () => {
    expect(formatAppVersionBadge('')).toBeNull()
    expect(formatAppVersionBadge(undefined)).toBeNull()
  })
})
