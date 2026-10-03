import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AuditLogEntry } from '../api'
import ServerSettingsAuditLog from './ServerSettingsAuditLog'

const moveEntry: AuditLogEntry = {
    id: 'audit-1',
    at: '2026-08-30T10:00:00.000Z',
    actor_id: 'moderator-1',
    server_id: 'server-1',
    action: 'voice_member_move',
    resource_type: 'member',
    resource_id: 'member-1',
    channel_id: 'voice-2',
    reason: 'Moved after a moderation warning',
    details: {
        source_channel_name: 'General',
        destination_channel_name: 'Support',
    },
    actor_username: 'moderator',
    resource_username: 'member',
    channel_name: 'Support',
}

describe('ServerSettingsAuditLog', () => {
    it('explains category renames and raid signals instead of raw action keys', () => {
        render(<ServerSettingsAuditLog
            entries={[
                { ...moveEntry, id: 'category', action: 'category_rename', resource_username: null, resource_id: null, channel_name: null, details: { old_name: 'Old', new_name: 'New' } },
                { ...moveEntry, id: 'raid', action: 'raid_message_burst', details: { message_count: 12, window_seconds: 10 } },
                { ...moveEntry, id: 'future', action: 'future_moderation_event' },
            ]}
            memberUsernameById={new Map()} actionFilter="" onActionFilterChange={vi.fn()}
            hasMore={false} loadingMore={false} onLoadMore={vi.fn()}
        />)
        expect(screen.getByText('Renamed category')).toBeVisible()
        expect(screen.getByText('Old to New')).toBeVisible()
        expect(screen.getByText('Message burst detected')).toBeVisible()
        expect(screen.getByText('12 messages in 10 seconds · in Support')).toBeVisible()
        expect(screen.getByText('Future moderation event')).toBeVisible()
        expect(screen.queryByText('category_rename')).not.toBeInTheDocument()
    })
    it('explains structured voice moderation context and reason', () => {
        render(
            <ServerSettingsAuditLog
                entries={[moveEntry]}
                memberUsernameById={new Map()}
                actionFilter=""
                onActionFilterChange={vi.fn()}
                hasMore={false}
                loadingMore={false}
                onLoadMore={vi.fn()}
            />,
        )

        expect(screen.getByText('moderator')).toBeVisible()
        expect(screen.getByText('Moved')).toBeVisible()
        expect(screen.getByText('member')).toBeVisible()
        expect(screen.getByText('from General to Support')).toBeVisible()
        expect(screen.getByText('Moved after a moderation warning')).toBeVisible()
    })

    it('reports filter changes and requests the next server page', () => {
        const onActionFilterChange = vi.fn()
        const onLoadMore = vi.fn()
        render(
            <ServerSettingsAuditLog
                entries={[moveEntry]}
                memberUsernameById={new Map()}
                actionFilter=""
                onActionFilterChange={onActionFilterChange}
                hasMore
                loadingMore={false}
                onLoadMore={onLoadMore}
            />,
        )

        fireEvent.change(screen.getByLabelText('Filter audit log by action'), {
            target: { value: 'voice_member_disconnect' },
        })
        expect(onActionFilterChange).toHaveBeenCalledWith('voice_member_disconnect')

        fireEvent.click(screen.getByRole('button', { name: 'Load older entries' }))
        expect(onLoadMore).toHaveBeenCalledTimes(1)
    })
})
