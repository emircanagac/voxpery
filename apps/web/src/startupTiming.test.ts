import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatStartupReport,
  getLastStartupReport,
  markStartup,
  noteStartupRequest,
  resetStartupTimingForTests,
} from './startupTiming'

describe('startup timing', () => {
  let clock = 0
  beforeEach(() => {
    localStorage.clear()
    resetStartupTimingForTests()
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records each step once, counts requests and stores the finished start', () => {
    clock = 120
    markStartup('keyring')
    clock = 400
    noteStartupRequest('/api/auth/session')
    markStartup('session')
    clock = 650
    noteStartupRequest('/api/servers')
    clock = 900
    noteStartupRequest('/api/channels/server/s-1')
    noteStartupRequest('/api/channels/server/s-2')
    clock = 1500
    markStartup('keyring')
    noteStartupRequest('/api/messages/c-1')
    markStartup('firstMessages')
    // After the first messages nothing more belongs to the start.
    noteStartupRequest('/api/friends')

    const result = getLastStartupReport()!
    expect(result.requests).toBe(5)
    expect(result.totalMs).toBe(1500)
    expect(result.steps.map((step) => [step.step, step.atMs])).toEqual([
      ['keyring', 120],
      ['session', 400],
      ['servers', 650],
      ['channels', 900],
      ['firstMessages', 1500],
    ])
    expect(formatStartupReport(result)).toBe(
      '1.5 s in total, 5 requests (saved sign-in read 0.1 s, session checked 0.4 s, server list 0.7 s, first channel list 0.9 s, first messages 1.5 s)',
    )
    expect(console.info).toHaveBeenCalledTimes(1)
  })

  it('reads nothing when no start finished or the stored value is broken', () => {
    expect(getLastStartupReport()).toBeNull()
    localStorage.setItem('voxpery-last-startup', '{"steps":"no"}')
    expect(getLastStartupReport()).toBeNull()
  })
})
