import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from './secureStorage'
import {
  canOpenDesktopMediaPermissionSettings,
  desktopMediaPermissionRecoveryMessage,
  openDesktopMediaPermissionSettings,
} from './desktopMediaPermissions'

vi.mock('./secureStorage', () => ({ isTauri: vi.fn() }))

const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform')

function setPlatform(userAgent: string, platform: string): void {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
  Object.defineProperty(navigator, 'platform', { configurable: true, value: platform })
}

describe('desktop media permission recovery', () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(true)
    setPlatform('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64')
  })

  afterEach(() => {
    if (originalUserAgent) Object.defineProperty(navigator, 'userAgent', originalUserAgent)
    if (originalPlatform) Object.defineProperty(navigator, 'platform', originalPlatform)
    vi.clearAllMocks()
  })

  it('does not mistake a Linux microphone capture failure for missing portal services', async () => {
    const message = desktopMediaPermissionRecoveryMessage('microphone')
    expect(message).toContain('denied or failed')
    expect(message).toContain('WebKitGTK and PipeWire logs')
    expect(message).not.toContain('xdg-desktop-portal')
    expect(canOpenDesktopMediaPermissionSettings()).toBe(false)
    await expect(openDesktopMediaPermissionSettings('microphone')).resolves.toBe(false)
  })

  it('keeps native settings available on platforms that can open them', () => {
    setPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32')
    expect(canOpenDesktopMediaPermissionSettings()).toBe(true)
  })

  it('does not expose native settings to a regular browser', () => {
    vi.mocked(isTauri).mockReturnValue(false)
    expect(canOpenDesktopMediaPermissionSettings()).toBe(false)
  })
})
