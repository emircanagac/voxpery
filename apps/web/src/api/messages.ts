import { apiFetch } from './client'
import type { AuthToken, MessageWithAuthor } from './contracts'

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
