import type { AuditLogEntry } from '../api'
import { raidEventLabel, raidEventSummary, readableEventName } from '../moderationEventText'
import { formatDateTime } from '../dateFormat'

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
    { value: 'role_create', label: 'Roles: create' },
    { value: 'role_update', label: 'Roles: edit' },
    { value: 'role_reorder', label: 'Roles: reorder' },
    { value: 'role_delete', label: 'Roles: delete' },
    { value: 'member_role_change', label: 'Roles: member roles' },
    { value: 'channel_override_update', label: 'Permissions: channel override' },
    { value: 'channel_override_delete', label: 'Permissions: remove channel override' },
    { value: 'category_override_update', label: 'Permissions: category override' },
    { value: 'category_override_delete', label: 'Permissions: remove category override' },
    { value: 'category_create', label: 'Categories: create' },
    { value: 'category_delete', label: 'Categories: delete' },
    { value: 'channel_reorder', label: 'Channels: reorder' },
    { value: 'category_reorder', label: 'Categories: reorder' },
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

const PERMISSION_LABELS: Record<string, string> = {
    MANAGE_SERVER: 'Full admin',
}

function permissionLabel(name: string) {
    const known = PERMISSION_LABELS[name]
    if (known) return known
    const words = name.toLowerCase().replace(/_/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
}

function permissionList(value: unknown) {
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === 'string').map(permissionLabel)
}

/** "allowed: A, B · denied: C" for an override change, or null when nothing is set. */
function overrideSummary(details: Record<string, unknown> | null | undefined) {
    const allow = permissionList(details?.allow)
    const deny = permissionList(details?.deny)
    const parts = [
        allow.length ? `allowed: ${allow.join(', ')}` : null,
        deny.length ? `denied: ${deny.join(', ')}` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' · ') : null
}

/** What changed in a role edit: rename, color and permissions gained or lost. */
function roleUpdateSummary(details: Record<string, unknown> | null | undefined) {
    const parts: string[] = []
    const oldName = textDetail(details, 'old_name')
    const newName = textDetail(details, 'new_name')
    if (oldName && newName) parts.push(`renamed from ${oldName}`)
    if (details && 'new_color' in details) parts.push('color changed')
    const permissions = details?.permissions as Record<string, unknown> | undefined
    const added = permissionList(permissions?.added)
    const removed = permissionList(permissions?.removed)
    if (added.length) parts.push(`granted ${added.join(', ')}`)
    if (removed.length) parts.push(`revoked ${removed.join(', ')}`)
    return parts.length ? parts.join(' · ') : null
}

function toAuditText(
    entry: AuditLogEntry,
    targetName: string | null,
    details: Record<string, unknown> | null | undefined,
) {
    let actionText = readableEventName(entry.action)
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
        case 'invite_rotate':
            actionText = 'Reset the invite link'
            targetDesc = null
            contextText = null
            break
        case 'category_rename': {
            actionText = 'Renamed category'
            const oldName = textDetail(details, 'old_name')
            const newName = textDetail(details, 'new_name')
            targetDesc = oldName && newName ? `${oldName} to ${newName}` : 'Unknown category'
            contextText = null
            break
        }
        case 'category_create':
        case 'category_delete':
            actionText = entry.action === 'category_create' ? 'Created category' : 'Deleted category'
            targetDesc = textDetail(details, 'name') ?? 'Unknown category'
            contextText = null
            break
        case 'role_create':
            actionText = 'Created role'
            targetDesc = textDetail(details, 'name') ?? 'Unknown role'
            contextText = permissionList(details?.permissions).join(', ') || null
            break
        case 'role_update':
            actionText = 'Edited role'
            targetDesc = textDetail(details, 'name') ?? 'Unknown role'
            contextText = roleUpdateSummary(details)
            break
        case 'role_delete':
            actionText = 'Deleted role'
            targetDesc = textDetail(details, 'name') ?? 'Unknown role'
            contextText = null
            break
        case 'role_reorder':
            actionText = 'Reordered roles'
            targetDesc = null
            contextText = null
            break
        case 'channel_override_update':
        case 'category_override_update':
        case 'channel_override_delete':
        case 'category_override_delete': {
            const removed = entry.action.endsWith('_delete')
            actionText = removed ? 'Removed permission override for' : 'Changed permissions for'
            targetDesc = textDetail(details, 'role_name') ?? 'Unknown role'
            const place = entry.action.startsWith('channel_')
                ? (channelName ? `#${channelName}` : 'a channel')
                : (textDetail(details, 'category') ?? 'a category')
            const summary = removed ? null : overrideSummary(details)
            contextText = [`in ${place}`, summary].filter(Boolean).join(' · ')
            break
        }
        case 'channel_reorder': {
            actionText = 'Reordered channels'
            targetDesc = null
            const moved = Array.isArray(details?.channels) ? details.channels.length : 0
            contextText = moved ? `${moved} ${moved === 1 ? 'channel' : 'channels'} moved` : null
            break
        }
        case 'category_reorder':
            actionText = 'Reordered categories'
            targetDesc = null
            contextText = null
            break
        case 'member_ban':
            actionText = 'Banned'
            break
        case 'member_unban':
            actionText = 'Unbanned'
            break
        case 'member_timeout_create':
            actionText = 'Timed out'
            break
        case 'member_timeout_clear':
            actionText = 'Removed timeout from'
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
        default:
            if (entry.action.startsWith('raid_')) {
                actionText = raidEventLabel(entry.action)
                const summary = raidEventSummary(entry.action, details)
                contextText = [summary, contextText].filter(Boolean).join(' · ') || null
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
                                        {formatDateTime(entry.at)}
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
