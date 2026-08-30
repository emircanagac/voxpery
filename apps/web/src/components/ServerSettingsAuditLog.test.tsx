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
