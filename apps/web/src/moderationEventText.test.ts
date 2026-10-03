import { describe, expect, it } from 'vitest'
import { raidEventLabel, raidEventSummary, readableEventName } from './moderationEventText'

describe('moderation event presentation', () => {
    it('labels known raid signals and keeps unknown names readable', () => {
        expect(raidEventLabel('raid_message_burst')).toBe('Message burst detected')
        expect(raidEventLabel('new_account_join_burst')).toBe('Rapid new-account joins detected')
        expect(raidEventLabel('future_signal')).toBe('Future signal')
        expect(raidEventLabel('constructor')).toBe('Constructor')
        expect(raidEventLabel('__proto__')).toBe('Proto')
        expect(readableEventName('category_permissions_update')).toBe('Category permissions update')
    })

    it('summarizes counts and windows without exposing raw metadata', () => {
        expect(raidEventSummary('raid_message_burst', { message_count: 12, window_seconds: 10 })).toBe('12 messages in 10 seconds')
        expect(raidEventSummary('join_burst', { join_count: 10, window_minutes: 5, client_ip: 'private' })).toBe('10 joins in 5 minutes')
        expect(raidEventSummary('invite_spike', { invite_count: 5, window_seconds: 60 })).toBe('5 invites in 60 seconds')
        expect(raidEventSummary('new_account_join_burst', { new_account_join_count: 5, window_minutes: 5 })).toBe('5 new-account joins in 5 minutes')
    })

    it('handles missing, malformed, and future metadata safely', () => {
        for (const metadata of [null, [], 'invalid', { message_count: '12' }, { message_count: NaN }, { message_count: -1 }]) {
            expect(raidEventSummary('message_burst', metadata)).toBeNull()
        }
        expect(raidEventSummary('future_signal', { count: 12 })).toBeNull()
        expect(raidEventSummary('message_burst', { message_count: 12, window_seconds: Infinity })).toBe('12 messages')
    })
})
