import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Turnstile script recovery', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    document.getElementById('cf-turnstile-script')?.remove()
    delete window.turnstile
  })

  it('shares loading, validates readiness and leaves the successful script installed', async () => {
    const { loadTurnstileScript } = await import('./turnstileScript')
    const first = loadTurnstileScript()
    expect(loadTurnstileScript()).toBe(first)
    const script = document.getElementById('cf-turnstile-script')!
    expect(script).toHaveAttribute('src', 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit')
    window.turnstile = { render: vi.fn() } as unknown as typeof window.turnstile
    script.dispatchEvent(new Event('load'))
    await first
    await loadTurnstileScript()
    expect(document.getElementById('cf-turnstile-script')).toBe(script)
  })

  it('removes a failed owned script and makes retry load a new script', async () => {
    const { loadTurnstileScript } = await import('./turnstileScript')
    const first = loadTurnstileScript()
    const rejected = expect(first).rejects.toThrow('could not be loaded')
    const failed = document.getElementById('cf-turnstile-script')!
    failed.dispatchEvent(new Event('error'))
    await rejected
    const retry = loadTurnstileScript()
    const retried = document.getElementById('cf-turnstile-script')!
    expect(retried).not.toBe(failed)
    const retryRejected = expect(retry).rejects.toThrow('could not be initialized')
    retried.dispatchEvent(new Event('load'))
    await retryRejected
  })

  it('times out a stalled request without reporting success', async () => {
    const { loadTurnstileScript } = await import('./turnstileScript')
    const rejected = expect(loadTurnstileScript()).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(document.getElementById('cf-turnstile-script')).toBeNull()
  })

  it('does not replace an unrelated script with the same id', async () => {
    const script = document.createElement('script')
    script.id = 'cf-turnstile-script'
    script.src = 'https://example.test/unrelated.js'
    document.head.appendChild(script)
    const { loadTurnstileScript } = await import('./turnstileScript')
    await expect(loadTurnstileScript()).rejects.toThrow('configuration is invalid')
    expect(document.getElementById(script.id)).toBe(script)
  })

  it('recovers from a stalled provider script left by a previous page mount', async () => {
    const old = document.createElement('script')
    old.id = 'cf-turnstile-script'
    old.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    document.head.appendChild(old)
    const { loadTurnstileScript } = await import('./turnstileScript')
    const rejected = expect(loadTurnstileScript()).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    const retry = loadTurnstileScript()
    expect(document.getElementById(old.id)).not.toBe(old)
    const retryRejected = expect(retry).rejects.toThrow('could not be loaded')
    document.getElementById(old.id)!.dispatchEvent(new Event('error'))
    await retryRejected
  })
})
