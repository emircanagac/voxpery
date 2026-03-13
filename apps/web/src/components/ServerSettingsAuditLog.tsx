import { useEffect, useMemo, useState } from 'react'
import type { AuditLogEntry } from '../api'

type ServerSettingsAuditLogProps = {
    entries: AuditLogEntry[]
    memberUsernameById: Map<string, string>
}

const INITIAL_VISIBLE = 50
const PAGE_SIZE = 50

function toAuditText(entry: AuditLogEntry, targetName: string | null, details: Record<string, unknown> | null | undefined) {
    let actionText = entry.action
    let targetDesc = targetName

    switch (entry.action) {
        case 'channel_create':
            actionText = 'Created channel'
            targetDesc = details?.name ? `#${details.name}` : 'Unknown Channel'
            break
        case 'channel_delete':
            actionText = 'Deleted channel'
            targetDesc = details?.name ? `#${details.name}` : 'Unknown Channel'
            break
        case 'channel_rename':
            actionText = 'Renamed channel'
            targetDesc = details?.old_name && details?.new_name ? `#${details.old_name} → #${details.new_name}` : 'Unknown Channel'
            break
        case 'server_update':
            actionText = 'Updated server settings'
            targetDesc = null
            break
        case 'member_kick':
            actionText = 'Kicked member'
            break
        case 'member_role_change':
            actionText = 'Updated member roles'
            break
        case 'message_pin':
            actionText = 'Pinned a message'
            targetDesc = details?.channel_id ? 'in a channel' : null
            break
        case 'message_unpin':
            actionText = 'Unpinned a message'
            targetDesc = details?.channel_id ? 'in a channel' : null
            break
    }

    return { actionText, targetDesc }
}

export default function ServerSettingsAuditLog({ entries, memberUsernameById }: ServerSettingsAuditLogProps) {
    const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)

    useEffect(() => {
        setVisibleCount(INITIAL_VISIBLE)
    }, [entries])

    const visibleEntries = useMemo(
        () => entries.slice(0, Math.min(visibleCount, entries.length)),
        [entries, visibleCount]
    )

    const hasMore = visibleEntries.length < entries.length

    return (
        <>
            <div className="server-settings-audit-list">
                {visibleEntries.map((entry) => {
                    const actorName = entry.actor_username ?? memberUsernameById.get(entry.actor_id) ?? 'Unknown User'
                    const targetName = entry.resource_username ?? (entry.resource_id ? memberUsernameById.get(entry.resource_id) ?? null : null)
                    const details = entry.details as Record<string, unknown> | null | undefined
                    const { actionText, targetDesc } = toAuditText(entry, targetName, details)

                    return (
                        <div key={entry.id} className="server-settings-audit-row">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                    <strong style={{ color: 'var(--text-normal)' }}>{actorName}</strong>
                                    <span style={{ color: 'var(--text-muted)' }}>{actionText}</span>
                                    {targetDesc && (
                                        <strong style={{ color: 'var(--text-normal)' }}>{targetDesc}</strong>
                                    )}
                                </div>
                                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                    {new Date(entry.at).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    )
                })}
            </div>
            {hasMore && (
                <div className="server-settings-audit-actions">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                    >
                        Load older entries
                    </button>
                </div>
            )}
        </>
    )
}
