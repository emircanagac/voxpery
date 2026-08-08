import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isTauri } from './secureStorage'
import { openExternalUrl } from './openExternalUrl'

vi.mock('./secureStorage', () => ({
  isTauri: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

describe('openExternalUrl', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReset()
    vi.mocked(openUrl).mockClear()
    vi.restoreAllMocks()
  })

  it('opens HTTPS links in a protected web tab', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    await openExternalUrl('https://github.com/emircanagac/voxpery/issues/new')

    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/emircanagac/voxpery/issues/new',
      '_blank',
      'noopener,noreferrer',
    )
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('uses the system browser from the Tauri desktop shell', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    await openExternalUrl('https://github.com/emircanagac/voxpery/issues/new?template=bug.md')

    expect(openUrl).toHaveBeenCalledWith(
      'https://github.com/emircanagac/voxpery/issues/new?template=bug.md',
    )
  })

  it('rejects non-HTTP protocols', async () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    await openExternalUrl('javascript:alert(1)')

    expect(openSpy).not.toHaveBeenCalled()
    expect(openUrl).not.toHaveBeenCalled()
  })
})
