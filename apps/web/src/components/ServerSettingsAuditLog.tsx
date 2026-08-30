import type { AuditLogEntry } from '../api'

type ServerSettingsAuditLogProps = {
    entries: AuditLogEntry[]
    memberUsernameById: Map<string, string>
    actionFilter: string
    onActionFilterChange: (action: string) => void
    hasMore: boolean
    loadingMore: boolean
    onLoadMore: () => void
}

const ACTION_OPTIONS = [
    { value: '', label: 'All actions' },
    { value: 'voice_member_mute', label: 'Voice: server mute' },
    { value: 'voice_member_unmute', label: 'Voice: server unmute' },
    { value: 'voice_member_deafen', label: 'Voice: server deafen' },
    { value: 'voice_member_undeafen', label: 'Voice: server undeafen' },
    { value: 'voice_member_disconnect', label: 'Voice: disconnect' },
    { value: 'voice_member_move', label: 'Voice: move' },
]

function textDetail(details: Record<string, unknown> | null | undefined, key: string) {
    const value = details?.[key]
    return typeof value === 'string' && value.trim() ? value : null
}

function toAuditText(
    entry: AuditLogEntry,
    targetName: string | null,
    details: Record<string, unknown> | null | undefined,
) {
    let actionText = entry.action
    let targetDesc = targetName
    const channelName = entry.channel_name ?? textDetail(details, 'channel_name')
    let contextText = channelName ? `in ${channelName}` : null

    switch (entry.action) {
        case 'channel_create':
            actionText = 'Created channel'
            targetDesc = textDetail(details, 'name') ? `#${textDetail(details, 'name')}` : 'Unknown Channel'
            contextText = null
            break
        case 'channel_delete':
            actionText = 'Deleted channel'
            targetDesc = textDetail(details, 'name') ? `#${textDetail(details, 'name')}` : 'Unknown Channel'
            contextText = null
            break
        case 'channel_rename': {
            actionText = 'Renamed channel'
            const oldName = textDetail(details, 'old_name')
            const newName = textDetail(details, 'new_name')
            targetDesc = oldName && newName ? `#${oldName} to #${newName}` : 'Unknown Channel'
            contextText = null
            break
        }
        case 'server_update':
            actionText = 'Updated server settings'
            targetDesc = null
            contextText = null
            break
        case 'member_kick':
            actionText = 'Kicked'
            break
        case 'member_role_change':
            actionText = 'Updated roles for'
            break
        case 'message_pin':
            actionText = 'Pinned a message'
            targetDesc = null
            break
        case 'message_unpin':
            actionText = 'Unpinned a message'
            targetDesc = null
            break
        case 'voice_member_mute':
            actionText = 'Server muted'
            break
        case 'voice_member_unmute':
            actionText = 'Removed server mute from'
            break
        case 'voice_member_deafen':
            actionText = 'Server deafened'
            break
        case 'voice_member_undeafen':
            actionText = 'Removed server deafen from'
            break
        case 'voice_member_disconnect':
            actionText = 'Disconnected'
            break
        case 'voice_member_move': {
            actionText = 'Moved'
            const source = textDetail(details, 'source_channel_name') ?? 'Unknown channel'
            const destination = textDetail(details, 'destination_channel_name')
                ?? entry.channel_name
                ?? 'Unknown channel'
            contextText = `from ${source} to ${destination}`
            break
        }
    }

    return { actionText, targetDesc, contextText }
}

export default function ServerSettingsAuditLog({
    entries,
    memberUsernameById,
    actionFilter,
    onActionFilterChange,
    hasMore,
    loadingMore,
    onLoadMore,
}: ServerSettingsAuditLogProps) {
    return (
        <>
            <div className="server-settings-audit-toolbar">
                <label>
                    <span>Action</span>
                    <select
                        aria-label="Filter audit log by action"
                        value={actionFilter}
                        onChange={(event) => onActionFilterChange(event.target.value)}
                    >
                        {ACTION_OPTIONS.map((option) => (
                            <option key={option.value || 'all'} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {entries.length === 0 ? (
                <div className="server-settings-empty-state">No audit entries match this filter.</div>
            ) : (
                <div className="server-settings-audit-list">
                    {entries.map((entry) => {
                        const actorName = entry.actor_username ?? memberUsernameById.get(entry.actor_id) ?? 'Unknown User'
                        const targetName = entry.resource_username
                            ?? (entry.resource_id ? memberUsernameById.get(entry.resource_id) ?? null : null)
                        const details = entry.details as Record<string, unknown> | null | undefined
                        const { actionText, targetDesc, contextText } = toAuditText(entry, targetName, details)

                        return (
                            <div key={entry.id} className="server-settings-audit-row">
                                <div className="server-settings-audit-row__top">
                                    <div className="server-settings-audit-row__summary">
                                        <strong className="server-settings-audit-row__actor">{actorName}</strong>
                                        <span className="server-settings-audit-row__action">{actionText}</span>
                                        {targetDesc && (
                                            <strong className="server-settings-audit-row__target">{targetDesc}</strong>
                                        )}
                                        {contextText && (
                                            <span className="server-settings-audit-row__context">{contextText}</span>
                                        )}
                                    </div>
                                    <time className="server-settings-audit-row__time" dateTime={entry.at}>
                                        {new Date(entry.at).toLocaleString()}
                                    </time>
                                </div>
                                {entry.reason && (
                                    <div className="server-settings-audit-row__reason">
                                        <span>Reason</span>
                                        <p>{entry.reason}</p>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {hasMore && (
                <div className="server-settings-audit-actions">
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                    >
                        {loadingMore ? 'Loading…' : 'Load older entries'}
                    </button>
                </div>
            )}
        </>
    )
}
