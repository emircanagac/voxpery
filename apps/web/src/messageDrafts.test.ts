import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearMessageDraftIfUnchanged,
  flushMessageDrafts,
  MESSAGE_DRAFT_MAX_ENTRIES,
  MESSAGE_DRAFT_MAX_LENGTH,
  MESSAGE_DRAFT_STORAGE_KEY,
  MESSAGE_DRAFT_TTL_MS,
  readMessageDraft,
  resetMessageDraftCacheForTests,
  saveMessageDraft,
} from './messageDrafts'

describe('message drafts', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMessageDraftCacheForTests()
  })

  it('isolates channel and DM drafts by user and conversation', () => {
    saveMessageDraft('user-a', 'channel', 'channel-1', 'server draft')
    saveMessageDraft('user-a', 'dm', 'channel-1', 'dm draft')
    saveMessageDraft('user-b', 'channel', 'channel-1', 'other user draft')

    expect(readMessageDraft('user-a', 'channel', 'channel-1')).toBe('server draft')
    expect(readMessageDraft('user-a', 'dm', 'channel-1')).toBe('dm draft')
    expect(readMessageDraft('user-b', 'channel', 'channel-1')).toBe('other user draft')
    expect(readMessageDraft('user-a', 'channel', 'channel-2')).toBe('')
  })

  it('survives a storage reload and clears only the matching sent draft', () => {
    saveMessageDraft('user-a', 'channel', 'channel-1', 'send me')
    saveMessageDraft('user-a', 'channel', 'channel-2', 'keep me')
    flushMessageDrafts()
    resetMessageDraftCacheForTests()

    expect(readMessageDraft('user-a', 'channel', 'channel-1')).toBe('send me')
    clearMessageDraftIfUnchanged('user-a', 'channel', 'channel-1', 'different text')
    expect(readMessageDraft('user-a', 'channel', 'channel-1')).toBe('send me')

    clearMessageDraftIfUnchanged('user-a', 'channel', 'channel-1', 'send me')
    expect(readMessageDraft('user-a', 'channel', 'channel-1')).toBe('')
    expect(readMessageDraft('user-a', 'channel', 'channel-2')).toBe('keep me')
  })

  it('drops expired, blank, oversized, and excess entries', () => {
    const now = Date.now()
    saveMessageDraft('user-a', 'dm', 'expired', 'old', now - MESSAGE_DRAFT_TTL_MS - 1)
    saveMessageDraft('user-a', 'dm', 'blank', '   ', now)
    saveMessageDraft('user-a', 'dm', 'long', 'x'.repeat(MESSAGE_DRAFT_MAX_LENGTH + 20), now)
    expect(readMessageDraft('user-a', 'dm', 'long', now)).toHaveLength(MESSAGE_DRAFT_MAX_LENGTH)
    for (let index = 0; index < MESSAGE_DRAFT_MAX_ENTRIES + 5; index += 1) {
      saveMessageDraft('user-a', 'channel', `channel-${index}`, `draft-${index}`, now + index)
    }
    flushMessageDrafts()
    resetMessageDraftCacheForTests()

    expect(readMessageDraft('user-a', 'dm', 'expired', now)).toBe('')
    expect(readMessageDraft('user-a', 'dm', 'blank', now)).toBe('')

    const stored = JSON.parse(localStorage.getItem(MESSAGE_DRAFT_STORAGE_KEY) ?? '{}') as {
      entries?: Record<string, unknown>
    }
    expect(Object.keys(stored.entries ?? {})).toHaveLength(MESSAGE_DRAFT_MAX_ENTRIES)
  })
})
