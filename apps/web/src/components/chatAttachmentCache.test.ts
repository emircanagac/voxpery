import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment } from '../types'

vi.mock('../api', () => ({ getApiBase: () => '' }))

const STORAGE_KEY = 'voxpery-attachment-image-sizes'

async function freshCache() {
  vi.resetModules()
  return import('./chatAttachmentCache')
}

function photo(sha256: string | undefined, signature: string): Attachment {
  return {
    id: 'photo-id',
    sha256,
    url: `/api/attachments/content/photo-id?exp=1&sig=${signature}`,
    name: 'photo.png',
    type: 'image/png',
  } as Attachment
}

describe('attachment image sizes', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('keys a size by the image content, whichever signed URL carries it', async () => {
    const cache = await freshCache()
    const key = cache.getAttachmentImageSizeKey(photo('abc', 'one'))
    expect(cache.getAttachmentImageSizeKey(photo('abc', 'two'))).toBe(key)
    cache.rememberAttachmentImageSize(key, 1080, 720)
    expect(cache.getAttachmentImageSize(key)).toEqual({ width: 1080, height: 720 })
    // Without a content hash the signed URL is left out of the key.
    expect(cache.getAttachmentImageSizeKey(photo(undefined, 'one')))
      .toBe(cache.getAttachmentImageSizeKey(photo(undefined, 'two')))
  })

  it('remembers sizes across page loads and ignores invalid ones', async () => {
    const cache = await freshCache()
    cache.rememberAttachmentImageSize('sha256:a', 400, 300)
    cache.rememberAttachmentImageSize('sha256:bad', 0, 300)
    cache.rememberAttachmentImageSize('sha256:nan', Number.NaN, 300)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([['sha256:a', 400, 300]])

    const reloaded = await freshCache()
    expect(reloaded.getAttachmentImageSize('sha256:a')).toEqual({ width: 400, height: 300 })
    expect(reloaded.getAttachmentImageSize('sha256:bad')).toBeNull()
  })

  it('starts empty when the stored value is not a size list', async () => {
    localStorage.setItem(STORAGE_KEY, '{"not":"a list"')
    expect((await freshCache()).getAttachmentImageSize('sha256:a')).toBeNull()
    localStorage.setItem(STORAGE_KEY, JSON.stringify([['sha256:a', -1, 10], ['sha256:b', 10, 20], 'x']))
    const cache = await freshCache()
    expect(cache.getAttachmentImageSize('sha256:a')).toBeNull()
    expect(cache.getAttachmentImageSize('sha256:b')).toEqual({ width: 10, height: 20 })
  })

  it('keeps only the most recent sizes', async () => {
    const cache = await freshCache()
    for (let index = 0; index <= cache.MAX_ATTACHMENT_IMAGE_SIZE_ENTRIES; index += 1) {
      cache.rememberAttachmentImageSize(`sha256:${index}`, 100, 100)
    }
    expect(cache.getAttachmentImageSize('sha256:0')).toBeNull()
    expect(cache.getAttachmentImageSize(`sha256:${cache.MAX_ATTACHMENT_IMAGE_SIZE_ENTRIES}`)).not.toBeNull()
  })

  it('forgets every size on sign-out', async () => {
    const cache = await freshCache()
    cache.rememberAttachmentImageSize('sha256:a', 400, 300)
    vi.advanceTimersByTime(1000)
    cache.rememberAttachmentImageSize('sha256:b', 400, 300)
    cache.clearAttachmentCaches()
    vi.advanceTimersByTime(1000)
    expect(cache.getAttachmentImageSize('sha256:a')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('draws an image scaled down into its box, never up', async () => {
    const { attachmentImageDisplaySize } = await freshCache()
    expect(attachmentImageDisplaySize({ width: 1080, height: 1080 })).toEqual({ width: 220, height: 220 })
    expect(attachmentImageDisplaySize({ width: 1600, height: 400 })).toEqual({ width: 320, height: 80 })
    expect(attachmentImageDisplaySize({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 })
  })
})
