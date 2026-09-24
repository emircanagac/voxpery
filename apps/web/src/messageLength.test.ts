import { describe, expect, it } from 'vitest'
import { countMessageCharacters, messageBodyLimit, MESSAGE_MAX_CHARACTERS, truncateMessage } from './messageLength'

describe('message length', () => {
  it('counts Unicode code points and preserves whole emoji when truncating', () => {
    expect(countMessageCharacters('a😀ğ')).toBe(3)
    expect(truncateMessage('a😀ğ', 2)).toBe('a😀')
  })

  it('includes the reply quote in the available composer length', () => {
    const reply = { username: 'alice', contentSnippet: 'hello' }
    expect(messageBodyLimit(reply)).toBe(MESSAGE_MAX_CHARACTERS - countMessageCharacters('> @alice: hello\n\n'))
    expect(messageBodyLimit(null)).toBe(MESSAGE_MAX_CHARACTERS)
  })
})
