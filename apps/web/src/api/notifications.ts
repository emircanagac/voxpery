import { apiFetch } from './client'
import type { AuthToken } from './contracts'

export interface ChannelNotificationState {
    channel_id: string
    server_id: string
    /** Messages from other people after the read mark, at most 99. */
    unread_count: number
    /** Mentions after the read mark, at most 99. */
    mention_count: number
}

export interface NotificationMutes {
    muted_server_ids: string[]
    muted_channel_ids: string[]
}

export interface NotificationState extends NotificationMutes {
    /** Only channels with something unread; a channel that is missing is read. */
    channels: ChannelNotificationState[]
}

export const notificationApi = {
    getState: (token: AuthToken) =>
        apiFetch<NotificationState>('/api/notifications/state', { token }),

    /** Moves the read mark of a server channel forward, to `messageId` or to its newest message. */
    markChannelRead: (channelId: string, messageId: string | undefined, token: AuthToken) =>
        apiFetch<{ channel_id: string; last_read_at: string | null }>(
            `/api/notifications/channels/${encodeURIComponent(channelId)}/read`,
            { method: 'POST', body: messageId ? { message_id: messageId } : {}, token },
        ),

    setMutes: (
        targets: { server_ids?: string[]; channel_ids?: string[] },
        muted: boolean,
        token: AuthToken,
    ) =>
        apiFetch<NotificationMutes>('/api/notifications/mutes', {
            method: 'PUT',
            body: { server_ids: targets.server_ids ?? [], channel_ids: targets.channel_ids ?? [], muted },
            token,
        }),
}
