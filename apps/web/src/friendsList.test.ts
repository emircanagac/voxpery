import { describe, expect, it } from 'vitest'
import type { DmChannel, Friend } from './api'
import { getVisibleFriendsForFilter, upsertDmChannel } from './friendsList'

function friend(id: string, username: string, status: string): Friend {
  return {
    id,
    username,
    avatar_url: null,
    status,
  }
}

function dmChannel(id: string, peerUsername: string): DmChannel {
  return {
    id,
    peer_id: `peer-${id}`,
    peer_username: peerUsername,
    peer_avatar_url: null,
    peer_status: 'online',
    last_message_at: null,
    unread_count: 0,
  }
}

describe('friends list helpers', () => {
  it('orders all friends with active users first, then alphabetically', () => {
    const visible = getVisibleFriendsForFilter(
      [
        friend('offline-a', 'Aaron', 'offline'),
        friend('online-z', 'Zed', 'online'),
        friend('dnd-b', 'Bella', 'dnd'),
        friend('offline-c', 'Clara', 'offline'),
        friend('online-a', 'Adam', 'online'),
      ],
      'all',
    )

    expect(visible.map((item) => item.username)).toEqual(['Adam', 'Bella', 'Zed', 'Aaron', 'Clara'])
  })

  it('keeps the online filter limited to active friends', () => {
    const visible = getVisibleFriendsForFilter(
      [
        friend('offline-a', 'Aaron', 'offline'),
        friend('online-z', 'Zed', 'online'),
        friend('dnd-b', 'Bella', 'dnd'),
      ],
      'online',
    )

    expect(visible.map((item) => item.username)).toEqual(['Bella', 'Zed'])
  })

  it('upserts opened DM channels without leaving stale duplicates', () => {
    const current = [dmChannel('old-a', 'alpha'), dmChannel('old-b', 'bravo')]
    const updated = { ...dmChannel('old-b', 'bravo'), unread_count: 2 }

    expect(upsertDmChannel(current, updated)).toEqual([updated, current[0]])
    expect(upsertDmChannel(current, dmChannel('new-c', 'charlie')).map((channel) => channel.id)).toEqual([
      'new-c',
      'old-a',
      'old-b',
    ])
  })
})
