export interface MessageSearchFilters {
    text: string
    from?: string
    hasAttachment: boolean
}

export function parseMessageSearchInput(input: string): MessageSearchFilters {
    const tokens = input.trim().split(/\s+/).filter(Boolean)
    const textParts: string[] = []
    let from: string | undefined
    let hasAttachment = false

    for (const token of tokens) {
        const lower = token.toLowerCase()
        if (lower === 'has:attachment' || lower === 'has:attachments') {
            hasAttachment = true
            continue
        }
        if (lower === 'from:') {
            continue
        }
        if (lower.startsWith('from:') && token.length > 'from:'.length) {
            from = token.slice('from:'.length).replace(/^@/, '').trim()
            continue
        }
        textParts.push(token)
    }

    return {
        text: textParts.join(' '),
        from: from || undefined,
        hasAttachment,
    }
}

export function buildMessageSearchQuery(input: string, limit = 100): string {
    const filters = parseMessageSearchInput(input)
    const params = new URLSearchParams()
    params.set('q', filters.text)
    params.set('limit', String(limit))
    if (filters.from) params.set('from', filters.from)
    if (filters.hasAttachment) params.set('has_attachment', 'true')
    return params.toString()
}
