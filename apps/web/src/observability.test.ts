import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureObservability,
  isObservabilityEventCode,
  reportFrontendCrash,
  reportObservabilityEvent,
  resetObservabilityForTests,
} from './observability'

describe('privacy-safe observability', () => {
  beforeEach(() => {
    resetObservabilityForTests()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops queued events when the server feature is disabled', async () => {
    reportObservabilityEvent('voice_join_failed')
    configureObservability(false)
    await Promise.resolve()

    expect(fetch).not.toHaveBeenCalled()
  })

  it('flushes only allowlisted event codes without error details or identifiers', async () => {
    reportObservabilityEvent('desktop_oauth_return_received')
    configureObservability(true)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    const payloads = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body)))
    expect(payloads).toEqual([
      { event: 'frontend_session_started', client: 'web' },
      { event: 'desktop_oauth_return_received', client: 'web' },
    ])
    expect(JSON.stringify(payloads)).not.toMatch(/token|email|username|message|stack|url|device/i)
  })

  it('counts at most one frontend crash per page session', async () => {
    configureObservability(true)
    reportFrontendCrash()
    reportFrontendCrash()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    const crashCalls = vi.mocked(fetch).mock.calls.filter(([, options]) =>
      String(options?.body).includes('frontend_crash')
    )
    expect(crashCalls).toHaveLength(1)
  })

  it('rejects arbitrary runtime event names', () => {
    expect(isObservabilityEventCode('voice_join_succeeded')).toBe(true)
    expect(isObservabilityEventCode('user_joined_secret-channel')).toBe(false)
  })
})
