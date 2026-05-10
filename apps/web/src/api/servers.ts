import { apiFetch } from './client'
import type { AuditLogEntry, AuthToken, AutoModRule, AutoModTriggerType, Channel, MemberInfo, Server, ServerBanEntry, ServerDetail, ServerInvitePreview, ServerReportEntry, ServerRole } from './contracts'

export const serverApi = {
    getInvitePreview: (inviteCode: string) =>
        apiFetch<ServerInvitePreview>(`/api/servers/invite/${encodeURIComponent(inviteCode)}`),

    list: (token: AuthToken) =>
        apiFetch<Server[]>('/api/servers', { token }),

    get: (serverId: string, token: AuthToken) =>
        apiFetch<ServerDetail>(`/api/servers/${serverId}`, { token }),

    create: (name: string, description: string | undefined, token: AuthToken) =>
        apiFetch<Server>('/api/servers', { method: 'POST', body: { name, description }, token }),

    update: (
        serverId: string,
        payload: { name?: string; icon_url?: string; description?: string; clear_icon?: boolean },
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

    listReports: (serverId: string, token: AuthToken) =>
        apiFetch<ServerReportEntry[]>(`/api/servers/${serverId}/reports`, { token }),

    listAutoModRules: (serverId: string, token: AuthToken) =>
        apiFetch<AutoModRule[]>(`/api/servers/${serverId}/automod-rules`, { token }),

    createAutoModRule: (
        serverId: string,
        payload: {
            name: string
            trigger_type: AutoModTriggerType
            pattern?: string | null
            mention_limit?: number | null
            enabled?: boolean
            exempt_role_ids?: string[]
            exempt_channel_ids?: string[]
        },
        token: AuthToken,
    ) =>
        apiFetch<AutoModRule>(`/api/servers/${serverId}/automod-rules`, {
            method: 'POST',
            body: payload,
            token,
        }),

    updateAutoModRule: (
        serverId: string,
        ruleId: string,
        payload: Partial<{
            name: string
            trigger_type: AutoModTriggerType
            pattern: string | null
            mention_limit: number | null
            enabled: boolean
            exempt_role_ids: string[]
            exempt_channel_ids: string[]
        }>,
        token: AuthToken,
    ) =>
        apiFetch<AutoModRule>(`/api/servers/${serverId}/automod-rules/${ruleId}`, {
            method: 'PATCH',
            body: payload,
            token,
        }),

    deleteAutoModRule: (serverId: string, ruleId: string, token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}/automod-rules/${ruleId}`, {
            method: 'DELETE',
            token,
        }),

    reportUser: (
        serverId: string,
        reportedUserId: string,
        reason: string,
        details: string | null,
        token: AuthToken,
    ) =>
        apiFetch<void>(`/api/servers/${serverId}/reports/user`, {
            method: 'POST',
            body: { reported_user_id: reportedUserId, reason, details },
            token,
        }),

    reportMessage: (
        serverId: string,
        messageId: string,
        reason: string,
        details: string | null,
        token: AuthToken,
    ) =>
        apiFetch<void>(`/api/servers/${serverId}/reports/message`, {
            method: 'POST',
            body: { message_id: messageId, reason, details },
            token,
        }),

    resolveReport: (serverId: string, reportId: string, token: AuthToken) =>
        apiFetch<void>(`/api/servers/${serverId}/reports/${reportId}/resolve`, {
            method: 'POST',
            token,
        }),

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
