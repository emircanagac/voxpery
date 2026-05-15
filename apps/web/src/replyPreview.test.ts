import { describe, expect, it } from 'vitest'
import { cleanReplyQuotePreview, createReplyContentSnippet } from './replyPreview'

describe('reply preview helpers', () => {
  it('uses the body when replying to an existing reply message', () => {
    expect(createReplyContentSnippet('> @alice: hello there\n\nactual response')).toBe('actual response')
  })

  it('does not recursively include nested reply quote prefixes', () => {
    expect(cleanReplyQuotePreview('> @alice: > @bob: hello there')).toBe('hello there')
  })

  it('normalizes whitespace and truncates long snippets', () => {
    const snippet = createReplyContentSnippet('line one\nline two and some extra text', 12)
    expect(snippet).toBe('line one lin...')
  })
})
