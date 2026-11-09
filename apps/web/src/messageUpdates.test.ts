import { describe, expect, it } from 'vitest'
import type { MessageWithAuthor } from './api'
import { applyMessageUpdate } from './messageUpdates'

function message(reactions: MessageWithAuthor['reactions'], content = 'hello'): MessageWithAuthor {
  return {
    id: 'm1',
    channel_id: 'c1',
    content,
    reactions,
    created_at: '2026-11-09T00:00:00Z',
    author: { user_id: 'author', username: 'author' },
  } as MessageWithAuthor
}

describe('applyMessageUpdate', () => {
  it("keeps this user's reactions when someone else reacts", () => {
    const existing = message([{ emoji: '👍', count: 1, reacted: true }])
    // Bob adds 🎉 and his own 👍; the payload's flags are computed for Bob.
    const incoming = message([
      { emoji: '👍', count: 2, reacted: true },
      { emoji: '🎉', count: 1, reacted: true },
    ])

    const next = applyMessageUpdate(existing, incoming, 'bob', 'alice')

    expect(next.reactions).toEqual([
      { emoji: '👍', count: 2, reacted: true },
      { emoji: '🎉', count: 1, reacted: false },
    ])
  })

  it("does not clear this user's reaction when someone else edits or unreacts", () => {
    const existing = message([{ emoji: '👍', count: 2, reacted: true }])
    const incoming = message([{ emoji: '👍', count: 1, reacted: false }], 'edited')

    const next = applyMessageUpdate(existing, incoming, 'bob', 'alice')

    expect(next.content).toBe('edited')
    expect(next.reactions).toEqual([{ emoji: '👍', count: 1, reacted: true }])
  })

  it("takes the flags as sent in the acting user's own sessions", () => {
    const existing = message([{ emoji: '👍', count: 1, reacted: false }])
    const incoming = message([{ emoji: '👍', count: 2, reacted: true }])

    expect(applyMessageUpdate(existing, incoming, 'alice', 'alice').reactions).toEqual([
      { emoji: '👍', count: 2, reacted: true },
    ])
  })

  it('keeps client-only fields of the cached message', () => {
    const existing = { ...message([]), clientStatus: 'sent' as const }
    const next = applyMessageUpdate(existing, message([], 'edited'), 'bob', 'alice')
    expect(next.clientStatus).toBe('sent')
    expect(next.content).toBe('edited')
  })
})
