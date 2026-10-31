import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachmentResolutionCache,
  decodedAttachmentImageCache,
  defaultAttachmentResolution,
} from './components/chatAttachmentCache'
import { ACTIVE_SERVER_STORAGE_KEY, clearLocalSessionData, LAST_CHANNELS_STORAGE_KEY } from './localSessionData'

describe('clearLocalSessionData', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    attachmentResolutionCache.clear()
    decodedAttachmentImageCache.clear()
  })

  it('forgets the resolved attachments and navigation of the signed-out account', () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revoke }))
    attachmentResolutionCache.set('private', {
      ...defaultAttachmentResolution('https://api.example.test/file', 'private'),
      resolvedUrl: 'blob:private',
    })
    attachmentResolutionCache.set('public', defaultAttachmentResolution('https://cdn.example.test/file', 'public'))
    decodedAttachmentImageCache.add('blob:private')
    sessionStorage.setItem(LAST_CHANNELS_STORAGE_KEY, '{"server":"channel"}')
    sessionStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, 'server')

    clearLocalSessionData()

    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:private')
    expect(attachmentResolutionCache.size).toBe(0)
    expect(decodedAttachmentImageCache.size).toBe(0)
    expect(sessionStorage.getItem(LAST_CHANNELS_STORAGE_KEY)).toBeNull()
    expect(sessionStorage.getItem(ACTIVE_SERVER_STORAGE_KEY)).toBeNull()
  })
})
