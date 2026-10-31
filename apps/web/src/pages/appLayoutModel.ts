import { type MessageWithAuthor, type Channel } from '../api'
import { type SafetySettingsTab } from '../components/ServerSettingsSafety'
import { LAST_CHANNELS_STORAGE_KEY } from '../localSessionData'

/** Types, limits and pure helpers of the server view (AppLayout). */
export type UiMessage = MessageWithAuthor & {
    clientId?: string
    clientStatus?: 'sending' | 'failed'
    clientError?: string
    clientDraft?: string
}

export type ServerSettingsLocalTab = 'overview' | 'roles' | 'rules' | 'safety' | 'audit' | 'danger'
export type ServerSettingsOpenTab = ServerSettingsLocalTab | SafetySettingsTab

export const SERVER_SETTINGS_SECTION_META = {
    overview: {
        eyebrow: 'Workspace',
        title: 'Overview',
        hint: 'Update your server identity, invite flow, and core presentation.',
        /** Shown to members who can view the overview but not edit it. */
        readOnlyHint: 'See this server’s name, description, and invite link.',
    },
    roles: {
        eyebrow: 'Access Control',
        title: 'Roles',
        hint: 'Shape permissions, moderation powers, and the hierarchy your members see.',
    },
    rules: {
        eyebrow: 'Community',
        title: 'Community',
        hint: 'Give new members a clear starting point, then set expectations with server rules.',
    },
    audit: {
        eyebrow: 'Moderation',
        title: 'Audit Log',
        hint: 'Review important changes and actions taken across the server.',
    },
    safety: {
        eyebrow: 'Safety',
        title: 'Safety',
        hint: 'Review reports, configure moderation filters, and manage bans in one place.',
    },
    danger: {
        eyebrow: 'Ownership',
        title: 'Danger Zone',
        hint: 'Destructive actions live here. Review carefully before continuing.',
    },
} as const

export function isSafetySettingsTab(tab: ServerSettingsOpenTab): tab is SafetySettingsTab {
    return tab === 'reports' || tab === 'automod' || tab === 'bans'
}

export function normalizeServerSettingsTab(tab: ServerSettingsOpenTab): ServerSettingsLocalTab {
    return isSafetySettingsTab(tab) ? 'safety' : tab
}

/** Page size for message list (pagination). Must match backend max (100) or less. */
export const MESSAGE_PAGE_SIZE = 50
export const CHANNEL_NAME_MAX = 32
export const CATEGORY_NAME_MAX = 32
export const SERVER_NAME_MAX = 100
export const CHANNEL_DESCRIPTION_MAX = 120
export const WELCOME_GUIDE_DISMISSED_STORAGE_KEY = 'voxpery-dismissed-welcome-guides'
export const REPORT_REASONS = [
    { value: 'spam', label: 'Spam' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'inappropriate_content', label: 'Inappropriate content' },
    { value: 'impersonation', label: 'Impersonation' },
    { value: 'other', label: 'Other' },
] as const

// Permission bit masks (must stay in sync with backend Permissions flags).
export const PERM_VIEW_SERVER = 1 << 0
export const PERM_MANAGE_SERVER = 1 << 1
export const PERM_MANAGE_ROLES = 1 << 2
export const PERM_MANAGE_CHANNELS = 1 << 3
export const PERM_KICK_MEMBERS = 1 << 4
export const PERM_BAN_MEMBERS = 1 << 5
export const PERM_VIEW_AUDIT_LOG = 1 << 6
export const PERM_SEND_MESSAGES = 1 << 7
export const PERM_MANAGE_MESSAGES = 1 << 8
export const PERM_MANAGE_PINS = 1 << 9
export const PERM_CONNECT_VOICE = 1 << 10
export const PERM_MUTE_MEMBERS = 1 << 11
export const PERM_DEAFEN_MEMBERS = 1 << 12
export const PERM_MOVE_MEMBERS = 1 << 13

export { LAST_CHANNELS_STORAGE_KEY }

export function validateChannelNameInput(raw: string): string | null {
    const value = raw.trim()
    if (!value) return 'Channel name is required.'
    if (Array.from(value).length > CHANNEL_NAME_MAX) {
        return `Channel name must be ${CHANNEL_NAME_MAX} characters or fewer.`
    }
    if (!/^[\p{L}\p{N}_ #-]+$/u.test(value)) {
        return "Channel name can only include letters, numbers, spaces, '#', '-' and '_'."
    }
    if (value.includes('  ')) {
        return 'Channel name cannot contain consecutive spaces.'
    }
    return null
}

export function validateCategoryNameInput(raw: string): string | null {
    const value = raw.trim()
    if (!value) return 'Category name is required.'
    if (Array.from(value).length > CATEGORY_NAME_MAX) {
        return `Category name must be ${CATEGORY_NAME_MAX} characters or fewer.`
    }
    if (!/^[\p{L}\p{N}_ #-]+$/u.test(value)) {
        return "Category name can only include letters, numbers, spaces, '#', '-' and '_'."
    }
    if (value.includes('  ')) {
        return 'Category name cannot contain consecutive spaces.'
    }
    return null
}

export function validateChannelDescriptionInput(raw: string): string | null {
    const value = raw.trim()
    if (!value) return null
    if (Array.from(value).length > CHANNEL_DESCRIPTION_MAX) {
        return `Channel description must be ${CHANNEL_DESCRIPTION_MAX} characters or fewer.`
    }
    return null
}

export function parseInviteInput(raw: string): string {
    const value = raw.trim()
    if (!value) return ''

    const directMatch = value.match(/(?:^|\/)invite\/([A-Za-z0-9_-]{1,32})\/?$/i)
    if (directMatch?.[1]) return directMatch[1]

    try {
        const url = new URL(value)
        const pathMatch = url.pathname.match(/\/invite\/([A-Za-z0-9_-]{1,32})\/?$/i)
        if (pathMatch?.[1]) return pathMatch[1]
    } catch {
        // Not a full URL; treat as a raw invite code.
    }

    return value
}

export function channelTypeOrder(type: Channel['channel_type']): number {
    return type === 'text' ? 0 : 1
}

export function compareChannelsForSidebar(a: Channel, b: Channel): number {
    const aCat = a.category ?? 'Channels'
    const bCat = b.category ?? 'Channels'
    if (aCat !== bCat) return aCat.localeCompare(bCat)
    const typeDiff = channelTypeOrder(a.channel_type) - channelTypeOrder(b.channel_type)
    if (typeDiff !== 0) return typeDiff
    return a.position - b.position
}

export function getStoredChannelId(serverId: string): string | null {
    try {
        const raw = sessionStorage.getItem(LAST_CHANNELS_STORAGE_KEY)
        if (!raw) return null
        const map = JSON.parse(raw) as Record<string, string>
        return map[serverId] || null
    } catch {
        return null
    }
}

export function setStoredChannelId(serverId: string, channelId: string | null) {
    try {
        const raw = sessionStorage.getItem(LAST_CHANNELS_STORAGE_KEY)
        const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
        if (channelId) map[serverId] = channelId
        else delete map[serverId]
        sessionStorage.setItem(LAST_CHANNELS_STORAGE_KEY, JSON.stringify(map))
    } catch {
        // ignore
    }
}

export function getDismissedWelcomeGuideIds(): Set<string> {
    try {
        const raw = localStorage.getItem(WELCOME_GUIDE_DISMISSED_STORAGE_KEY)
        const ids = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
    } catch {
        return new Set()
    }
}

export function isWelcomeGuideDismissed(serverId: string): boolean {
    return getDismissedWelcomeGuideIds().has(serverId)
}

export function dismissWelcomeGuide(serverId: string) {
    try {
        const ids = getDismissedWelcomeGuideIds()
        ids.add(serverId)
        localStorage.setItem(WELCOME_GUIDE_DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(ids)))
    } catch {
        // ignore
    }
}

export function escapeMentionPattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function messageMentionsUser(content: string | undefined, username: string | undefined): boolean {
    if (!content) return false
    const normalized = content.toLowerCase()
    if (normalized.includes('@all') || normalized.includes('@everyone')) return true
    if (!username) return false
    const pattern = new RegExp(`(^|\\s)@${escapeMentionPattern(username)}(?=\\s|$)`, 'i')
    return pattern.test(content)
}

/** Notice for an account removed from a server by someone else; leaving yourself shows nothing. */
export function removalNoticeFor(reason: string | undefined, serverName: string): { title: string; message: string } | null {
    switch (reason) {
        case 'kicked':
            return { title: 'Removed from server', message: `You were removed from ${serverName}.` }
        case 'banned':
            return { title: 'Banned from server', message: `You were banned from ${serverName}.` }
        case 'deleted':
            return { title: 'Server deleted', message: `${serverName} was deleted.` }
        default:
            return null
    }
}
