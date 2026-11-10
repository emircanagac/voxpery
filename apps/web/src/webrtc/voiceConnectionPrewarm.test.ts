import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadPrewarm() {
  vi.resetModules()
  return import('./voiceConnectionPrewarm')
}

describe('voice connection warm-up', () => {
  const fetchMock = vi.fn(async () => new Response(null))

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockClear()
    vi.unstubAllGlobals()
  })

  it('sends nothing before a join told it where the voice server is', async () => {
    const { prewarmVoiceConnection } = await loadPrewarm()
    prewarmVoiceConnection(1_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('warms up the voice server origin over HTTPS at most every 30 seconds', async () => {
    const { prewarmVoiceConnection, rememberLivekitUrl } = await loadPrewarm()
    rememberLivekitUrl('wss://livekit.example.test/rtc?access_token=secret')
    prewarmVoiceConnection(1_000)
    prewarmVoiceConnection(20_000)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('https://livekit.example.test', { method: 'HEAD', credentials: 'omit', cache: 'no-store' })
    prewarmVoiceConnection(31_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ignores addresses that are not a voice server URL', async () => {
    const { prewarmVoiceConnection, rememberLivekitUrl } = await loadPrewarm()
    rememberLivekitUrl('javascript:alert(1)')
    prewarmVoiceConnection(1_000)
    rememberLivekitUrl('not a url')
    prewarmVoiceConnection(40_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
