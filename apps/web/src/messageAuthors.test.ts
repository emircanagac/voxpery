import { describe, expect, it } from 'vitest'
import { withAuthorsFrom, withUpdatedAuthor } from './messageAuthors'
import type { Message } from './types'

function message(id: string, userId: string, avatarUrl?: string): Message {
  return {
    id,
    channel_id: 'channel-1',
    content: id,
    created_at: '2026-10-12T10:00:00.000Z',
    attachments: [{ id: `${id}-file`, url: `/uploads/${id}.png` } as never],
    author: { user_id: userId, username: userId, avatar_url: avatarUrl },
  }
}

describe('withUpdatedAuthor', () => {
  it('updates only that user\'s author details and keeps attachments', () => {
    const messages = [message('m1', 'alice', '/a/old.png'), message('m2', 'bob', '/b.png')]
    const next = withUpdatedAuthor(messages, { id: 'alice', username: 'alice2', avatar_url: '/a/new.png' })
    expect(next[0].author).toEqual({ user_id: 'alice', username: 'alice2', avatar_url: '/a/new.png' })
    expect(next[0].attachments).toBe(messages[0].attachments)
    expect(next[1]).toBe(messages[1])
  })

  it('clears the avatar when the photo is removed', () => {
    const [updated] = withUpdatedAuthor([message('m1', 'alice', '/a/old.png')], { id: 'alice', avatar_url: null })
    expect(updated.author.avatar_url).toBeUndefined()
    expect(updated.author.username).toBe('alice')
  })

  it('returns the same array when nothing changes', () => {
    const messages = [message('m1', 'alice', '/a.png')]
    expect(withUpdatedAuthor(messages, { id: 'bob', avatar_url: '/b.png' })).toBe(messages)
    expect(withUpdatedAuthor(messages, { id: 'alice', username: 'alice', avatar_url: '/a.png' })).toBe(messages)
  })
})

describe('withAuthorsFrom', () => {
  it('gives cached history the author details from a fresh page', () => {
    const cached = [message('old', 'alice', '/a/old.png'), message('other', 'carol', '/c.png')]
    const fresh = [message('new', 'alice', '/a/new.png')]
    const next = withAuthorsFrom(cached, fresh)
    expect(next[0].author.avatar_url).toBe('/a/new.png')
    expect(next[1]).toBe(cached[1])
    expect(withAuthorsFrom(cached, [])).toBe(cached)
  })
})
