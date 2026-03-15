import type { User, Server, Channel, Message, SignalingMessage, WsEvent } from './types'
import { isTauri } from './secureStorage'

export type { User, Server, Channel, Message, SignalingMessage, WsEvent }

export interface AuditLogEntry {
    id: string
    at: string
    actor_id: string
    server_id: string | null
    action: string
    resource_type: string
    resource_id: string | null
    details: unknown | null
    actor_username: string | null
    resource_username: string | null
}

// Re-export User as UserPublic for compat
export type UserPublic = User

// Prefer localhost so cookie is sent after Google OAuth when frontend is at localhost:5173 (same host).
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

/** In browser, if page is on localhost but API_BASE uses 127.0.0.1, return API base with localhost so the auth cookie is sent. */
function effectiveApiBase(): string {
    if (typeof window === 'undefined') return API_BASE
    if (window.location.hostname === 'localhost' && API_BASE.includes('127.0.0.1')) {
        return API_BASE.replace(/127\.0\.0\.1/g, 'localhost')
    }
    return API_BASE
}

/** Exposed so UI can show which API the app is using (e.g. in connection errors). */
export function getApiBase(): string {
    return effectiveApiBase()
}

/** URL to start Google OAuth. Redirects to Google then back to callback; frontend should use window.location or <a href>. */
export function getGoogleAuthUrl(redirectPath: string = '/'): string {
    const origin = isTauri() ? 'voxpery://auth' : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173')
    const params = new URLSearchParams({
        redirect: redirectPath,
        origin,
    })
    return `${effectiveApiBase()}/api/auth/google?${params.toString()}`
}

/** Ping backend /health endpoint. Returns true if server is reachable and healthy. */
export async function checkHealth(): Promise<boolean> {
    try {
        const url = `${effectiveApiBase()}/health`
        if (isTauri()) {
            const mod = await import('@tauri-apps/plugin-http')
            const res = await mod.fetch(url, { method: 'GET', timeout: 5 } as RequestInit & { timeout?: number })
            return res.ok
        } else {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 5000)
            const res = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
            })
            clearTimeout(timer)
            return res.ok
        }
    } catch {
        return false
    }
}

/** True when page origin differs from API origin (e.g. localhost:5173 → api.voxpery.com). Cookie auth won't work; use Bearer token. */
export function isCrossOrigin(): boolean {
    if (typeof window === 'undefined') return false
    try {
        const apiOrigin = new URL(getApiBase()).origin
        return window.location.origin !== apiOrigin
    } catch {
        return false
    }
}

/** Web: null (cookie auth). Desktop: string from secure storage. */
export type AuthToken = string | null

/** Token is optional: web uses httpOnly cookie when null. */
interface FetchOptions {
    method?: string
    body?: unknown
    token?: string | null
}

function isNetworkError(err: unknown): boolean {
    if (err instanceof TypeError && err.message === 'Failed to fetch') return true
    if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        const name = (err as { name?: string }).name ?? ''
        if (msg.includes('networkerror') || msg.includes('failed to fetch') || name === 'TypeError') return true
    }
    return false
}

/** True if error indicates auth failure (401); used to avoid logout on network/server errors. */
export function isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err)
    return (
        msg.includes('Authentication required') ||
        msg.includes('Invalid credentials') ||
        msg.includes('Unauthorized')
    )
}

/** Parses API errors so login/register can show a user-friendly message and error code. */
export function getAuthErrorMessage(err: unknown): { message: string; code?: string } {
    const msg = err instanceof Error ? err.message : String(err)
    const match = msg.match(/^([A-Z_]+):(.+)$/s)
    if (match) {
        const [, code, rest] = match
        let message = rest.trim()
        if (code === 'CONNECTION_ERROR') {
            const fallback = 'Cannot connect to the server. Check your connection.'
            message = message || fallback
            // In desktop always show API URL so user can see if build had wrong VITE_API_URL
            if (isTauri()) {
                const base = getApiBase()
                if (!message.includes('API:') && !message.includes(base)) {
                    message = `${message} — API: ${base}`
                }
            }
            return { code, message }
        }
        return { code: code ?? undefined, message }
    }
    // No code prefix (e.g. raw "Failed to fetch" from plugin) — in desktop treat as connection error and show API URL
    let message = msg
    if (isTauri()) {
        const lower = String(msg).toLowerCase()
        if (lower.includes('fetch') || lower.includes('network') || lower.includes('connection')) {
            message = `${msg} — API: ${getApiBase()}`
            return { code: 'CONNECTION_ERROR', message }
        }
    }
    return { message }
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const { method = 'GET', body, token } = options

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }

    const url = `${effectiveApiBase()}${path}`
    const fetchOptions: RequestInit = {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: isTauri() ? 'omit' : 'include', // desktop: no cookies; web: httpOnly cookie
    }

    let res: Response
    try {
        if (isTauri()) {
            let tauriFetch: typeof fetch
            try {
                const mod = await import('@tauri-apps/plugin-http')
                tauriFetch = mod.fetch
            } catch (importErr) {
                const msg = importErr instanceof Error ? importErr.message : String(importErr)
                throw new Error(`CONNECTION_ERROR:Desktop plugin could not load. ${msg}`)
            }
            res = await tauriFetch(url, { ...fetchOptions, timeout: 30 } as RequestInit & { timeout?: number })
        } else {
            res = await fetch(url, fetchOptions)
        }
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : (err as { cause?: unknown })?.cause != null ? String((err as { cause: unknown }).cause) : ''
        const fullDetail = cause ? `${detail}. ${cause}` : detail
        if (isNetworkError(err) || isTauri()) {
            if (isTauri()) {
                console.error('[Voxpery] Connection failed. URL:', url, 'Error:', detail, cause || '')
                // Show API base in error so user can see if build had wrong VITE_API_URL
                const apiHint = ` (API: ${getApiBase()})`
                throw new Error(`CONNECTION_ERROR:Cannot connect to the server.${apiHint} ${fullDetail}`)
            }
            throw new Error(`CONNECTION_ERROR:Cannot connect to the server. ${fullDetail}`)
        }
        throw err
    }

    if (!res.ok) {
        const text = await res.text()
        let message: string
        try {
            const json = JSON.parse(text) as { error?: string }
            message = json.error || text || `HTTP ${res.status}`
        } catch {
            message = text || `HTTP ${res.status}`
        }
        throw new Error(message)
    }

    return res.json()
}

// ─── Auth ───────────────────────────────

export interface AuthResponse {
    token: string
    user: UserPublic
}

async function apiMultipartFetch<T>(path: string, formData: FormData, token?: string | null): Promise<T> {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const url = `${effectiveApiBase()}${path}`
    let res: Response
    try {
        res = await fetch(url, {
            method: 'POST',
            headers,
            body: formData,
            credentials: isTauri() ? 'omit' : 'include',
        })
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        if (isNetworkError(err) || isTauri()) {
            if (isTauri()) {
                const apiHint = ` (API: ${getApiBase()})`
                throw new Error(`CONNECTION_ERROR:Cannot connect to the server.${apiHint} ${detail}`)
            }
            throw new Error(`CONNECTION_ERROR:Cannot connect to the server. ${detail}`)
        }
        throw err
    }

    if (!res.ok) {
        const text = await res.text()
        let message: string
        try {
            const json = JSON.parse(text) as { error?: string }
            message = json.error || text || `HTTP ${res.status}`
        } catch {
            message = text || `HTTP ${res.status}`
        }
        throw new Error(message)
    }

    return res.json()
}

export interface DataExportPayload {
    exported_at: string
    account: {
        id: string
        username: string
        email: string
        avatar_url: string | null
        status: string
        dm_privacy: 'everyone' | 'friends'
        created_at: string
        google_connected: boolean
    }
    memberships: unknown[]
    friends: unknown[]
    friend_requests: unknown[]
    server_messages: unknown[]
    dm_messages: unknown[]
}

export interface DeleteAccountPayload {
    confirm: string
    password?: string
}



export const authApi = {
    register: (username: string, email: string, password: string, captcha_token?: string) =>
        apiFetch<AuthResponse>('/api/auth/register', {
            method: 'POST',
            body: { username, email, password, captcha_token },
        }),

    login: (identifier: string, password: string) =>
        apiFetch<AuthResponse>('/api/auth/login', {
            method: 'POST',
            body: { identifier, password },
        }),

    /** token optional: web uses httpOnly cookie when null. */
    updateStatus: (status: 'online' | 'dnd' | 'invisible', token: string | null) =>
        apiFetch<UserPublic>('/api/auth/status', {
            method: 'PATCH',
            body: { status },
            token: token ?? undefined,
        }),

    getMe: (token: string | null) =>
        apiFetch<UserPublic>('/api/auth/me', { token: token ?? undefined }),

    /** GET /api/auth/check-username?username=xxx — returns { available: boolean }. */
    checkUsername: (username: string, token: string | null) =>
        apiFetch<{ available: boolean }>(
            `/api/auth/check-username?username=${encodeURIComponent(username.trim())}`,
            { token: token ?? undefined },
        ),

    /** token optional: web uses httpOnly cookie when null. */
    updateProfile: (
        payload: { avatar_url?: string; clear_avatar?: boolean; dm_privacy?: 'everyone' | 'friends'; username?: string },
        token: string | null,
    ) =>
        apiFetch<UserPublic>('/api/auth/profile', {
            method: 'PATCH',
            body: payload,
            token: token ?? undefined,
        }),

    /** Clears httpOnly auth cookie (web). No token needed; call with credentials. */
    logout: () =>
        apiFetch<void>('/api/auth/logout', { method: 'POST' }),

    /** Change password. Returns success message and clears cookie (forces re-login). */
    changePassword: (oldPassword: string, newPassword: string, token: string | null) =>
        apiFetch<{ message: string }>('/api/auth/change-password', {
            method: 'POST',
            body: { old_password: oldPassword, new_password: newPassword },
            token: token ?? undefined,
        }),

    forgotPassword: (email: string) =>
        apiFetch<{ message: string }>('/api/auth/forgot-password', {
            method: 'POST',
            body: { email },
        }),

    resetPassword: (token: string, newPassword: string) =>
        apiFetch<{ message: string }>('/api/auth/reset-password', {
            method: 'POST',
            body: { token, new_password: newPassword },
        }),

    exportData: (token: string | null) =>
        apiFetch<DataExportPayload>('/api/auth/data-export', {
            method: 'GET',
            token: token ?? undefined,
        }),

    deleteAccount: (payload: DeleteAccountPayload, token: string | null) =>
        apiFetch<{ message: string }>('/api/auth/account', {
            method: 'DELETE',
            body: payload,
            token: token ?? undefined,
        }),
}

// ─── Servers ────────────────────────────

export interface ServerDetail extends Server {
    my_permissions: number
    members: MemberInfo[]
}

export interface MemberInfo {
    user_id: string
    username: string
    avatar_url: string | null
    role: string
    status: string
    role_color: string | null
    roles?: string[]
}

export interface Friend {
    id: string
    username: string
    avatar_url: string | null
    status: string
}

export interface FriendRequest {
    id: string
    requester_id: string
    receiver_id: string
    requester_username: string
    receiver_username: string
    status: string
    created_at: string
}

export interface FriendRequestsResponse {
    incoming: FriendRequest[]
    outgoing: FriendRequest[]
}

export interface DmChannel {
    id: string
    peer_id: string
    peer_username: string
    peer_avatar_url: string | null
    peer_status: string
    last_message_at: string | null
}

export interface DmReadState {
    peer_last_read_message_id: string | null
}

export interface ServerRole {
    id: string
    name: string
    color: string | null
    position: number
    permissions: number
}

export interface ChannelOverride {
    role_id: string
    allow: number
    deny: number
}

export interface ServerBanEntry {
    user_id: string
    banned_by: string
    reason: string | null
    created_at: string
    username: string
    banned_by_username: string
}

export interface UploadedAttachment {
    url: string
    type?: string
    name?: string
    size?: number
    sha256?: string
}

export interface ChannelCategory {
    name: string
}

export const serverApi = {
    list: (token: AuthToken) =>
        apiFetch<Server[]>('/api/servers', { token }),

    get: (serverId: string, token: AuthToken) =>
        apiFetch<ServerDetail>(`/api/servers/${serverId}`, { token }),

    create: (name: string, token: AuthToken) =>
        apiFetch<Server>('/api/servers', { method: 'POST', body: { name }, token }),

    update: (
        serverId: string,
        payload: { name?: string; icon_url?: string; clear_icon?: boolean },
        token: AuthToken,
    ) =>
        apiFetch<Server>(`/api/servers/${serverId}`, { method: 'PATCH', body: payload, token }),

    join: (inviteCode: string, token: AuthToken) =>
        apiFetch<Server>('/api/servers/join', { method: 'POST', body: { invite_code: inviteCode }, token }),

    leave: (serverId: string, token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}/leave`, { method: 'POST', token }),

    delete: (serverId: string, token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}`, { method: 'DELETE', token }),

    auditLog: (serverId: string, token: AuthToken) =>
        apiFetch<AuditLogEntry[]>(`/api/servers/${serverId}/audit-log`, { token }),

    listBans: (serverId: string, token: AuthToken) =>
        apiFetch<ServerBanEntry[]>(`/api/servers/${serverId}/bans`, { token }),

    unbanMember: (serverId: string, userId: string, token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}/bans/${userId}`, { method: 'DELETE', token }),

    channels: (serverId: string, token: AuthToken) =>
        apiFetch<Channel[]>(`/api/servers/${serverId}/channels`, { token }),
    channelMembers: (serverId: string, channelId: string, token: AuthToken) =>
        apiFetch<MemberInfo[]>(`/api/servers/${serverId}/channels/${channelId}/members`, { token }),

    listRoles: (serverId: string, token: AuthToken, opts?: { includeSystem?: boolean }) =>
        apiFetch<ServerRole[]>(
            `/api/servers/${serverId}/roles${opts?.includeSystem ? '?include_system=true' : ''}`,
            { token },
        ),

    createRole: (serverId: string, name: string, permissions: number, token: AuthToken, color?: string | null) =>
        apiFetch<ServerRole>(`/api/servers/${serverId}/roles`, {
            method: 'POST',
            body: { name, permissions, color: color ?? undefined },
            token,
        }),

    updateRole: (
        serverId: string,
        roleId: string,
        payload: { name?: string; permissions?: number; color?: string | null },
        token: AuthToken,
    ) => {
        const bodyToSend = {
            ...payload,
            color: payload.color === null ? '' : payload.color,
        }
        return apiFetch<ServerRole>(`/api/servers/${serverId}/roles/${roleId}`, {
            method: 'PATCH',
            body: bodyToSend,
            token,
        })
    },

    deleteRole: (serverId: string, roleId: string, token: AuthToken) =>
        apiFetch<unknown>(`/api/servers/${serverId}/roles/${roleId}`, {
            method: 'DELETE',
            token,
        }),
    reorderRoles: (serverId: string, roleIds: string[], token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}/roles/reorder`, {
            method: 'PATCH',
            body: { role_ids: roleIds },
            token,
        }),
    listMemberRoles: (serverId: string, userId: string, token: AuthToken) =>
        apiFetch<string[]>(`/api/servers/${serverId}/members/${userId}/roles`, {
            token,
        }),
    updateMemberRoles: (serverId: string, userId: string, roleIds: string[], token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}/members/${userId}/roles`, {
            method: 'PUT',
            body: { role_ids: roleIds },
            token,
        }),

    kickMember: (serverId: string, userId: string, token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}/members/${userId}`, { method: 'DELETE', token }),

    banMember: (serverId: string, userId: string, token: AuthToken, reason?: string) =>
        apiFetch<void>(`/api/servers/${serverId}/members/${userId}/ban`, {
            method: 'POST',
            body: reason ? { reason } : {},
            token,
        }),
}

// ─── Channels ───────────────────────────

export const channelApi = {
    create: (
        serverId: string,
        name: string,
        channelType: string,
        token: AuthToken,
        category?: string,
    ) =>
        apiFetch<Channel>('/api/channels', {
            method: 'POST',
            body: { server_id: serverId, name, channel_type: channelType, category },
            token,
        }),

    delete: (channelId: string, token: AuthToken) =>
        apiFetch<void>(`/api/channels/${channelId}`, { method: 'DELETE', token }),

    rename: (channelId: string, name: string, token: AuthToken, category?: string) =>
        apiFetch<Channel>(`/api/channels/${channelId}`, {
            method: 'PATCH',
            body: { name, category },
            token,
        }),

    reorder: (serverId: string, channelIds: string[], token: AuthToken) =>
        apiFetch<{ message: string }>('/api/channels/reorder', {
            method: 'PATCH',
            body: { server_id: serverId, channel_ids: channelIds },
            token,
        }),

    getOverrides: (channelId: string, token: AuthToken) =>
        apiFetch<ChannelOverride[]>(`/api/channels/${channelId}/overrides`, { token }),

    updateOverride: (channelId: string, roleId: string, allow: number, deny: number, token: AuthToken) =>
        apiFetch<ChannelOverride>(`/api/channels/${channelId}/overrides/${roleId}`, {
            method: 'PUT',
            body: { allow, deny },
            token,
        }),

    deleteOverride: (channelId: string, roleId: string, token: AuthToken) =>
        apiFetch<{ message: string }>(`/api/channels/${channelId}/overrides/${roleId}`, {
            method: 'DELETE',
            token,
        }),

    listCategories: (serverId: string, token: AuthToken) =>
        apiFetch<ChannelCategory[]>(`/api/channels/server/${serverId}/categories`, { token }),

    createCategory: (serverId: string, name: string, token: AuthToken) =>
        apiFetch<ChannelCategory>(`/api/channels/server/${serverId}/categories`, {
            method: 'POST',
            body: { name },
            token,
        }),

    renameCategory: (serverId: string, category: string, name: string, token: AuthToken) =>
        apiFetch<ChannelCategory>(
            `/api/channels/server/${serverId}/categories/${encodeURIComponent(category)}`,
            {
                method: 'PATCH',
                body: { name },
                token,
            },
        ),

    deleteCategory: (serverId: string, category: string, token: AuthToken, moveTo?: string | null) =>
        apiFetch<{ message: string }>(
            `/api/channels/server/${serverId}/categories/${encodeURIComponent(category)}${moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : ''}`,
            { method: 'DELETE', token },
        ),

    reorderCategories: (serverId: string, categoryNames: string[], token: AuthToken) =>
        apiFetch<{ message: string }>(
            `/api/channels/server/${serverId}/categories/reorder`,
            {
                method: 'PATCH',
                body: { category_names: categoryNames },
                token,
            },
        ),

    getCategoryOverrides: (serverId: string, category: string, token: AuthToken) =>
        apiFetch<ChannelOverride[]>(
            `/api/channels/server/${serverId}/categories/${encodeURIComponent(category)}/overrides`,
            { token },
        ),

    updateCategoryOverride: (serverId: string, category: string, roleId: string, allow: number, deny: number, token: AuthToken) =>
        apiFetch<ChannelOverride>(
            `/api/channels/server/${serverId}/categories/${encodeURIComponent(category)}/overrides/${roleId}`,
            {
                method: 'PUT',
                body: { allow, deny },
                token,
            },
        ),

    deleteCategoryOverride: (serverId: string, category: string, roleId: string, token: AuthToken) =>
        apiFetch<{ message: string }>(
            `/api/channels/server/${serverId}/categories/${encodeURIComponent(category)}/overrides/${roleId}`,
            {
                method: 'DELETE',
                token,
            },
        ),
    }

export const attachmentApi = {
    uploadFiles: (files: File[], token: AuthToken) => {
        const form = new FormData()
        for (const file of files) form.append('files', file, file.name)
        return apiMultipartFetch<UploadedAttachment[]>('/api/attachments/upload', form, token)
    },
}

// ─── Friends ───────────────────────────

export const friendApi = {
    list: (token: AuthToken) =>
        apiFetch<Friend[]>('/api/friends', { token }),

    requests: (token: AuthToken) =>
        apiFetch<FriendRequestsResponse>('/api/friends/requests', { token }),

    sendRequest: (username: string, token: AuthToken) =>
        apiFetch<void>('/api/friends/requests', {
            method: 'POST',
            body: { username },
            token,
        }),

    acceptRequest: (requestId: string, token: AuthToken) =>
        apiFetch<void>(`/api/friends/requests/${requestId}/accept`, {
            method: 'POST',
            token,
        }),

    rejectRequest: (requestId: string, token: AuthToken) =>
        apiFetch<void>(`/api/friends/requests/${requestId}/reject`, {
            method: 'POST',
            token,
        }),

    remove: (friendId: string, token: AuthToken) =>
        apiFetch<void>(`/api/friends/${friendId}`, {
            method: 'DELETE',
            token,
        }),
}

// ─── Direct Messages ───────────────────────────

export const dmApi = {
    listChannels: (token: AuthToken) =>
        apiFetch<DmChannel[]>('/api/dm/channels', { token }),

    getOrCreateChannel: (peerId: string, token: AuthToken) =>
        apiFetch<DmChannel>(`/api/dm/channels/${peerId}`, {
            method: 'POST',
            token,
        }),

    listMessages: (channelId: string, token: AuthToken, before?: string) =>
        apiFetch<MessageWithAuthor[]>(
            `/api/dm/messages/${channelId}${before ? `?before=${before}` : ''}`,
            { token },
        ),

    searchMessages: (channelId: string, q: string, token: AuthToken, limit = 100) =>
        apiFetch<MessageWithAuthor[]>(
            `/api/dm/messages/${channelId}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
            { token },
        ),

    sendMessage: (channelId: string, content: string, attachments: unknown, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/dm/messages/${channelId}`, {
            method: 'POST',
            body: { content, attachments },
            token,
        }),

    editMessage: (messageId: string, content: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/dm/messages/item/${messageId}`, {
            method: 'PATCH',
            body: { content },
            token,
        }),

    deleteMessage: (messageId: string, token: AuthToken) =>
        apiFetch<void>(`/api/dm/messages/item/${messageId}`, {
            method: 'DELETE',
            token,
        }),

    addReaction: (messageId: string, emoji: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/dm/messages/item/${messageId}/reactions`, {
            method: 'POST',
            body: { emoji },
            token,
        }),

    removeReaction: (messageId: string, emoji: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(
            `/api/dm/messages/item/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
            {
                method: 'DELETE',
                token,
            },
        ),

    readState: (channelId: string, token: AuthToken) =>
        apiFetch<DmReadState>(`/api/dm/channels/${channelId}/read-state`, { token }),

    listPins: (channelId: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor[]>(`/api/dm/channels/${channelId}/pins`, { token }),

    pinMessage: (channelId: string, messageId: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/dm/channels/${channelId}/pins`, {
            method: 'POST',
            body: { message_id: messageId },
            token,
        }),

    unpinMessage: (channelId: string, messageId: string, token: AuthToken) =>
        apiFetch<unknown>(`/api/dm/channels/${channelId}/pins/${messageId}`, {
            method: 'DELETE',
            token,
        }),
}

// ─── Messages ───────────────────────────

export type MessageWithAuthor = Message

export const messageApi = {
    list: (channelId: string, token: AuthToken, before?: string, limit = 50) =>
        apiFetch<MessageWithAuthor[]>(
            `/api/messages/${channelId}?limit=${limit}${before ? `&before=${before}` : ''}`,
            { token }
        ),

    search: (channelId: string, q: string, token: AuthToken, limit = 100) =>
        apiFetch<MessageWithAuthor[]>(
            `/api/messages/${channelId}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
            { token },
        ),

    send: (channelId: string, content: string, attachments: unknown, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/messages/${channelId}`, {
            method: 'POST',
            body: { content, attachments },
            token,
        }),

    delete: (messageId: string, token: AuthToken) =>
        apiFetch<{ message: string; id: string }>(`/api/messages/item/${messageId}`, {
            method: 'DELETE',
            token,
        }),

    edit: (messageId: string, content: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/messages/item/${messageId}`, {
            method: 'PATCH',
            body: { content },
            token,
        }),

    addReaction: (messageId: string, emoji: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/messages/item/${messageId}/reactions`, {
            method: 'POST',
            body: { emoji },
            token,
        }),

    removeReaction: (messageId: string, emoji: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(
            `/api/messages/item/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
            {
                method: 'DELETE',
                token,
            },
        ),

    listPins: (channelId: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor[]>(`/api/messages/${channelId}/pins`, { token }),

    pinMessage: (channelId: string, messageId: string, token: AuthToken) =>
        apiFetch<MessageWithAuthor>(`/api/messages/${channelId}/pins`, {
            method: 'POST',
            body: { message_id: messageId },
            token,
        }),

    unpinMessage: (channelId: string, messageId: string, token: AuthToken) =>
        apiFetch<unknown>(`/api/messages/${channelId}/pins/${messageId}`, {
            method: 'DELETE',
            token,
        }),
}

// ─── WebRTC (TURN from API so credentials not in bundle) ─────

export interface TurnCredentials {
    urls: string[]
    username?: string
    credential?: string
}

export interface LivekitTokenResponse {
    ws_url: string
    token: string
    room: string
    identity: string
}

export const webrtcApi = {
    /** GET /api/webrtc/turn-credentials (auth via cookie or Bearer). */
    getTurnCredentials: (token: string | null) =>
        apiFetch<TurnCredentials>('/api/webrtc/turn-credentials', { token: token ?? undefined }),
    /** GET /api/webrtc/livekit-token?channel_id=... (auth via cookie or Bearer). */
    getLivekitToken: (channelId: string, token: string | null) =>
        apiFetch<LivekitTokenResponse>(`/api/webrtc/livekit-token?channel_id=${encodeURIComponent(channelId)}`, { token: token ?? undefined }),
}

// ─── WebSocket ──────────────────────────

/** token required for desktop (Bearer not sent on WS); web uses cookie so token can be null. */
export function createWebSocket(token: string | null): WebSocket {
    const wsBase = effectiveApiBase().replace(/^http/, 'ws')
    const url = `${wsBase}/ws`
    if (token) {
        return new WebSocket(url, ['voxpery.auth', token])
    }
    return new WebSocket(url)
}
