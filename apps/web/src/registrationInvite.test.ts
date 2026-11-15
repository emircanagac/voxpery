import { describe, expect, it } from 'vitest'
import { inviteCodeFromInput, inviteCodeFromRedirect } from './registrationInvite'

describe('inviteCodeFromRedirect', () => {
  it('reads the code from an invite return path', () => {
    expect(inviteCodeFromRedirect('/invite/AbC123')).toBe('AbC123')
    expect(inviteCodeFromRedirect('/invite/AbC_1-2/?x=1#top')).toBe('AbC_1-2')
  })

  it('ignores every other path', () => {
    for (const path of [undefined, null, '', '/', '/servers', '/invite', '/invite/', '/invite/a/b', '/app/invite/AbC123']) {
      expect(inviteCodeFromRedirect(path)).toBeNull()
    }
    expect(inviteCodeFromRedirect(`/invite/${'a'.repeat(33)}`)).toBeNull()
  })
})

describe('inviteCodeFromInput', () => {
  it('accepts a bare code, an invite link and an invite path', () => {
    expect(inviteCodeFromInput('  AbC123  ')).toBe('AbC123')
    expect(inviteCodeFromInput('https://chat.example.com/invite/AbC123')).toBe('AbC123')
    expect(inviteCodeFromInput('/invite/AbC123')).toBe('AbC123')
  })

  it('rejects text that is neither a code nor an invite link', () => {
    for (const input of ['', '   ', 'has space', 'https://chat.example.com/servers', 'https://chat.example.com/invite/']) {
      expect(inviteCodeFromInput(input)).toBeNull()
    }
  })
})
