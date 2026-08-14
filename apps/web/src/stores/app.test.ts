import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './app'
import type { DmChannel } from '../api'

function dmChannel(id: string, unread_count: number): DmChannel {
    return {
        id,
        peer_id: `peer-${id}`,
        peer_username: `peer-${id}`,
        peer_avatar_url: null,
        peer_status: 'online',
        last_message_at: null,
        unread_count,
        pinned_at: null,
        is_pinned: false,
    }
}

describe('app store DM unread sync', () => {
    beforeEach(() => {
        localStorage.clear()
        useAppStore.setState({ dmUnread: {} })
    })

    it('hydrates unread counts from server DM channel metadata', () => {
        useAppStore.getState().setDmUnreadFromChannels([
            dmChannel('dm-a', 3),
            dmChannel('dm-b', 0),
        ])

        expect(useAppStore.getState().dmUnread).toEqual({ 'dm-a': 3 })
    })

    it('clears stale local unread when the server says a DM is read', () => {
        useAppStore.setState({ dmUnread: { 'dm-a': 2, 'dm-b': 1 } })

        useAppStore.getState().setDmUnreadFromChannels([
            dmChannel('dm-a', 0),
        ])

        expect(useAppStore.getState().dmUnread).toEqual({ 'dm-b': 1 })
    })

    it('preserves a notification channel until its visible message anchor is handled', () => {
        useAppStore.setState({ dmUnread: { 'dm-a': 2 } })

        useAppStore.getState().setDmUnreadFromChannels(
            [dmChannel('dm-a', 0)],
            new Set(['dm-a']),
        )

        expect(useAppStore.getState().dmUnread).toEqual({ 'dm-a': 2 })
    })
})
