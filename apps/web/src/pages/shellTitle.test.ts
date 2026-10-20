import { describe, expect, it } from 'vitest'
import { shellDocumentTitle, shellPlaceName } from './shellTitle'

describe('shell document title', () => {
  it('shows the unread total and the open place', () => {
    expect(shellDocumentTitle(0, null)).toBe('Voxpery')
    expect(shellDocumentTitle(3, '#general')).toBe('(3) #general | Voxpery')
    expect(shellDocumentTitle(250, 'Friends')).toBe('(99+) Friends | Voxpery')
  })

  it('names channels, direct messages and groups', () => {
    expect(shellPlaceName({ view: 'server', channel: { name: 'general', channel_type: 'text' } })).toBe('#general')
    expect(shellPlaceName({ view: 'server', channel: { name: 'Lounge', channel_type: 'voice' } })).toBe('Lounge')
    expect(shellPlaceName({ view: 'dm', dm: { peer_username: 'ada', is_group: false } })).toBe('@ada')
    expect(shellPlaceName({ view: 'dm', dm: { peer_username: 'ada, bob', is_group: true, name: 'Team' } })).toBe('Team')
    expect(shellPlaceName({ view: 'dm', dm: null })).toBeNull()
    expect(shellPlaceName({ view: 'friends' })).toBe('Friends')
  })
})
