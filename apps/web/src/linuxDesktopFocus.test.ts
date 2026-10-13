import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ isTauri: true, invoke: vi.fn(async () => undefined) }))

vi.mock('./secureStorage', () => ({ isTauri: () => mocks.isTauri }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { installLinuxDesktopKeyboardFocus } from './linuxDesktopFocus'

function stubPlatform(userAgent: string) {
  vi.stubGlobal('navigator', { ...navigator, userAgent, platform: '' })
}

async function click(target: EventTarget) {
  target.dispatchEvent(new Event('pointerup', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('installLinuxDesktopKeyboardFocus', () => {
  beforeEach(() => {
    mocks.isTauri = true
    mocks.invoke.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks the Linux desktop shell to refocus the page after each click', async () => {
    stubPlatform('Mozilla/5.0 (X11; Linux x86_64)')
    const dispose = installLinuxDesktopKeyboardFocus()
    const field = document.createElement('textarea')
    document.body.append(field)
    field.addEventListener('pointerup', (event) => event.stopPropagation())

    await click(field)
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('desktop_refocus_webview_keyboard'))

    dispose()
    mocks.invoke.mockClear()
    await click(field)
    expect(mocks.invoke).not.toHaveBeenCalled()
    field.remove()
  })

  it('does nothing on other platforms or in the browser', async () => {
    stubPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    const disposeWindows = installLinuxDesktopKeyboardFocus()
    await click(document.body)
    disposeWindows()

    stubPlatform('Mozilla/5.0 (X11; Linux x86_64)')
    mocks.isTauri = false
    const disposeWeb = installLinuxDesktopKeyboardFocus()
    await click(document.body)
    disposeWeb()

    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
