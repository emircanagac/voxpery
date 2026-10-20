import { describe, expect, it } from 'vitest'
import { removalNoticeFor } from './appLayoutModel'

describe('removalNoticeFor', () => {
  it('explains kicks, bans and deleted servers but stays quiet when you left yourself', () => {
    expect(removalNoticeFor('kicked', 'UI Test')).toEqual({ title: 'Removed from server', message: 'You were removed from UI Test.' })
    expect(removalNoticeFor('banned', 'UI Test')?.message).toBe('You were banned from UI Test.')
    expect(removalNoticeFor('deleted', 'UI Test')?.message).toBe('UI Test was deleted.')
    expect(removalNoticeFor('left', 'UI Test')).toBeNull()
    expect(removalNoticeFor(undefined, 'UI Test')).toBeNull()
  })
})
