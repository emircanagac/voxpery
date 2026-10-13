import { apiFetch } from './client'
import type { AuthToken, DmChannel } from './contracts'

// Separate from `dmApi` so it stays out of the startup bundle; only the Social page uses it.
export const groupDmApi = {
    create: (memberIds: string[], name: string | null, token: AuthToken) =>
        apiFetch<DmChannel>('/api/dm/groups', {
            method: 'POST',
            body: { member_ids: memberIds, name },
            token,
        }),

    rename: (channelId: string, name: string, token: AuthToken) =>
        apiFetch<DmChannel>(`/api/dm/groups/${channelId}`, {
            method: 'PATCH',
            body: { name },
            token,
        }),

    addMembers: (channelId: string, userIds: string[], token: AuthToken) =>
        apiFetch<DmChannel>(`/api/dm/groups/${channelId}/members`, {
            method: 'POST',
            body: { user_ids: userIds },
            token,
        }),

    removeMember: (channelId: string, userId: string, token: AuthToken) =>
        apiFetch<void>(`/api/dm/groups/${channelId}/members/${userId}`, {
            method: 'DELETE',
            token,
        }),
}
