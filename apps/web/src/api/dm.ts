import { apiFetch } from './client'
import type { AuthToken, DmChannel, DmReadState, MessageWithAuthor } from './contracts'
import { buildMessageSearchQuery } from '../searchFilters'

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
            `/api/dm/messages/${channelId}/search?${buildMessageSearchQuery(q, limit)}`,
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
