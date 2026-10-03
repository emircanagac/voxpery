const RAID_LABELS: Record<string, string> = {
    message_burst: 'Message burst detected',
    invite_spike: 'Invite spike detected',
    join_burst: 'Rapid joins detected',
    new_account_join_burst: 'Rapid new-account joins detected',
}

export function readableEventName(value: string): string {
    const words = value.replaceAll('_', ' ').trim()
    return words ? words[0].toUpperCase() + words.slice(1) : 'Unknown event'
}

export function raidEventLabel(eventType: string): string {
    const type = eventType.replace(/^raid_/, '')
    return Object.hasOwn(RAID_LABELS, type) ? RAID_LABELS[type] : readableEventName(type)
}

export function raidEventSummary(eventType: string, metadata: unknown): string | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
    const fields = metadata as Record<string, unknown>
    const counts: Record<string, [string, string]> = {
        message_burst: ['message_count', 'messages'],
        invite_spike: ['invite_count', 'invites'],
        join_burst: ['join_count', 'joins'],
        new_account_join_burst: ['new_account_join_count', 'new-account joins'],
    }
    const type = eventType.replace(/^raid_/, '')
    const spec = Object.hasOwn(counts, type) ? counts[type] : null
    if (!spec) return null
    const count = fields[spec[0]]
    const seconds = fields.window_seconds
    const minutes = fields.window_minutes
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
    const window = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? `${seconds} seconds`
        : typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
            ? `${minutes} minutes` : null
    return `${count} ${spec[1]}${window ? ` in ${window}` : ''}`
}
