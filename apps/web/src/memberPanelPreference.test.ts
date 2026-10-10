import { beforeEach, describe, expect, it } from 'vitest'
import { getMemberPanelOpen, setMemberPanelOpen } from './memberPanelPreference'

beforeEach(() => {
  localStorage.clear()
})

describe('member panel preference', () => {
  it('defaults to open and remembers a hidden panel', () => {
    expect(getMemberPanelOpen()).toBe(true)
    setMemberPanelOpen(false)
    expect(getMemberPanelOpen()).toBe(false)
    setMemberPanelOpen(true)
    expect(getMemberPanelOpen()).toBe(true)
  })
})
