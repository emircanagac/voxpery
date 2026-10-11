import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  nativeStore: new Map<string, string>(),
  autostartEnabled: false,
  installChannel: 'app',
}))

vi.mock('./secureStorage', () => ({ isTauri: () => true }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: { payload: { prefixedKey: string; data?: string } }) => {
    if (command === 'desktop_update_channel') return mocks.installChannel
    const { prefixedKey, data } = args.payload
    if (command === 'plugin:secure-storage|get_item') return mocks.nativeStore.get(prefixedKey) ?? null
    if (command === 'plugin:secure-storage|set_item' && data != null) mocks.nativeStore.set(prefixedKey, data)
    return null
  }),
}))

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: vi.fn(async () => mocks.autostartEnabled),
  enable: vi.fn(async () => { mocks.autostartEnabled = true }),
  disable: vi.fn(async () => { mocks.autostartEnabled = false }),
}))

beforeEach(() => {
  mocks.nativeStore.clear()
  mocks.autostartEnabled = false
  mocks.installChannel = 'app'
  localStorage.clear()
  vi.resetModules()
})

const loadDesktopSettings = () => import('./desktopSettings')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktop launch on startup default', () => {
  it.each([
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'],
    ['macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64)'],
  ])('enables launch on startup on a fresh %s install and records the choice', async (_platform, userAgent) => {
    vi.stubGlobal('navigator', { ...navigator, userAgent, platform: '' })
    const { bootstrapDesktopAutostartDefault } = await loadDesktopSettings()
    await expect(bootstrapDesktopAutostartDefault()).resolves.toBe(true)
    expect(mocks.autostartEnabled).toBe(true)
    // A recorded preference stops later launches and updates from applying the default again.
    mocks.autostartEnabled = false
    await expect(bootstrapDesktopAutostartDefault()).resolves.toBeNull()
    expect(mocks.autostartEnabled).toBe(false)
  })

  it('keeps launch on startup off when the user disabled it', async () => {
    const { bootstrapDesktopAutostartDefault, setStoredDesktopAutostartPreference } = await loadDesktopSettings()
    await setStoredDesktopAutostartPreference(false)
    await expect(bootstrapDesktopAutostartDefault()).resolves.toBeNull()
    expect(mocks.autostartEnabled).toBe(false)
  })

  it('does not offer or enable launch on startup in a Flatpak', async () => {
    mocks.installChannel = 'flatpak'
    const { bootstrapDesktopAutostartDefault, isDesktopAutostartSupported } = await loadDesktopSettings()
    await expect(isDesktopAutostartSupported()).resolves.toBe(false)
    await expect(bootstrapDesktopAutostartDefault()).resolves.toBeNull()
    expect(mocks.autostartEnabled).toBe(false)
  })
})
