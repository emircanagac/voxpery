import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAttachmentUrl } from './attachments'
import { getApiBase } from './client'

describe('resolveAttachmentUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends credentials to the API only', async () => {
    const fetchMock = vi.fn(async () => new Response('bytes', { headers: { 'content-type': 'text/plain' } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:attachment')
    const options = { forceAuthenticatedFetch: true }

    const foreign = 'https://files.example.test/report.pdf'
    await expect(resolveAttachmentUrl(foreign, 'secret-token', options)).resolves.toBe(foreign)
    expect(fetchMock).not.toHaveBeenCalled()

    const own = `${getApiBase()}/api/attachments/content/1`
    await expect(resolveAttachmentUrl(own, 'secret-token', options)).resolves.toBe('blob:attachment')
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(own, expect.objectContaining({
      credentials: 'include',
      headers: { Authorization: 'Bearer secret-token' },
    }))
  })
})
