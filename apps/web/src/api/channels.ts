import { apiFetch } from './client'
import type { AuthToken, Channel, ChannelCategory, ChannelOverride } from './contracts'

export const channelApi = {
    create: (
        serverId: string,
        name: string,
        channelType: string,
        token: AuthToken,
        category?: string,
        description?: string,
    ) =>
        apiFetch<Channel>('/api/channels', {
            method: 'POST',
            body: { server_id: serverId, name, description, channel_type: channelType, category },
            token,
        }),

    delete: (channelId: string, token: AuthToken) =>
        apiFetch<void>(`/api/channels/${channelId}`, { method: 'DELETE', token }),

    rename: (channelId: string, name: string, token: AuthToken, category?: string, description?: string) =>
        apiFetch<Channel>(`/api/channels/${channelId}`, {
            method: 'PATCH',
            body: { name, category, description },
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
