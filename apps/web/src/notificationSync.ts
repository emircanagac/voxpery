import { notificationApi, type NotificationState } from './api/notifications'
import type { AuthToken } from './api/contracts'
import { shouldTrackServerUnread } from './notificationPreferences'
import { useAppStore } from './stores/app'

/**
 * Keeps server-channel unread counts, mention counts and mutes in step with the server, which
 * owns them: badges survive a closed app and agree between devices. The store stays the place
 * the UI reads from; this module loads it from the server and reports local changes back.
 */

/** Set once per browser: the mutes stored here before the server kept them were sent up. */
const MUTES_IMPORTED_KEY = 'voxpery-notification-mutes-imported'
const READ_MARK_DELAY_MS = 800
const MUTE_IMPORT_BATCH = 200

/** True while the store is being filled from the server, so that fill is not sent back. */
let applyingRemoteState = false

function readFlag(key: string): boolean {
    try {
        return localStorage.getItem(key) === '1'
    } catch {
        return false
    }
}

function writeFlag(key: string) {
    try {
        localStorage.setItem(key, '1')
    } catch {
        // Without storage the import simply runs again; it only adds mutes that are still local.
    }
}

/** Unread and mention maps for the store, following the same mute rules as live messages. */
export function countsFromNotificationState(
    state: NotificationState,
    openChannelId: string | null,
): { unread: Record<string, number>; mentions: Record<string, number> } {
    const mutedServers = new Set(state.muted_server_ids)
    const mutedChannels = new Set(state.muted_channel_ids)
    const unread: Record<string, number> = {}
    const mentions: Record<string, number> = {}
    for (const channel of state.channels) {
        // The open channel is being read right now; its mark is on its way to the server.
        if (channel.channel_id === openChannelId) continue
        const isMutedServer = mutedServers.has(channel.server_id)
        const isMutedChannel = mutedChannels.has(channel.channel_id)
        const isMention = channel.mention_count > 0
        if (!shouldTrackServerUnread({ isMention, isMutedServer, isMutedChannel })) continue
        unread[channel.channel_id] = isMutedChannel ? channel.mention_count : channel.unread_count
        if (isMention) mentions[channel.channel_id] = channel.mention_count
    }
    return { unread, mentions }
}

/**
 * Loads the notification state from the server into the store. The first time a browser does
 * this, the mutes that only lived in it are sent up before the server list replaces them; that
 * happens once per browser, so a later account never inherits another account's mutes. Local
 * unread counts are never sent: the server already knows better.
 */
export async function loadNotificationState(
    token: AuthToken,
    openChannelId: () => string | null,
): Promise<void> {
    if (!readFlag(MUTES_IMPORTED_KEY)) {
        const { mutedServerIds, mutedChannelIds } = useAppStore.getState()
        for (let start = 0; start < Math.max(mutedServerIds.length, mutedChannelIds.length); start += MUTE_IMPORT_BATCH) {
            await notificationApi.setMutes({
                server_ids: mutedServerIds.slice(start, start + MUTE_IMPORT_BATCH),
                channel_ids: mutedChannelIds.slice(start, start + MUTE_IMPORT_BATCH),
            }, true, token)
        }
        writeFlag(MUTES_IMPORTED_KEY)
    }

    // Messages that arrive while the request travels are counted locally; keep them, since the
    // server answer may have been read before they were stored.
    const before = useAppStore.getState()
    const unreadBefore = before.serverUnreadByChannel
    const mentionsBefore = before.serverMentionsByChannel
    const state = await notificationApi.getState(token)
    const counts = countsFromNotificationState(state, openChannelId())
    const now = useAppStore.getState()
    keepArrivedMeanwhile(counts.unread, unreadBefore, now.serverUnreadByChannel)
    keepArrivedMeanwhile(counts.mentions, mentionsBefore, now.serverMentionsByChannel)
    applyingRemoteState = true
    try {
        useAppStore.getState().applyServerNotificationState({
            unread: counts.unread,
            mentions: counts.mentions,
            mutedServerIds: state.muted_server_ids,
            mutedChannelIds: state.muted_channel_ids,
        })
    } finally {
        applyingRemoteState = false
    }
}

function keepArrivedMeanwhile(
    target: Record<string, number>,
    before: Record<string, number>,
    now: Record<string, number>,
) {
    for (const [channelId, count] of Object.entries(now)) {
        const arrived = count - (before[channelId] ?? 0)
        if (arrived > 0) target[channelId] = Math.max(target[channelId] ?? 0, arrived)
    }
}

const pendingReadMarks = new Map<string, { timer: number; messageId?: string }>()

/**
 * Tells the server the channel was read, shortly after the last call for that channel so a burst
 * of incoming messages becomes one request. `messageId` is the newest message shown, when known.
 */
export function scheduleChannelRead(channelId: string, token: AuthToken, messageId?: string) {
    const pending = pendingReadMarks.get(channelId)
    if (pending) window.clearTimeout(pending.timer)
    const latestMessageId = messageId ?? pending?.messageId
    const timer = window.setTimeout(() => {
        pendingReadMarks.delete(channelId)
        notificationApi.markChannelRead(channelId, latestMessageId, token).catch(() => {
            // The mark is sent again the next time the channel is read.
        })
    }, READ_MARK_DELAY_MS)
    pendingReadMarks.set(channelId, { timer, messageId: latestMessageId })
}

function difference(next: string[], previous: string[]): string[] {
    const known = new Set(previous)
    return next.filter((id) => !known.has(id))
}

/**
 * Sends mute changes made in this window to the server. Returns the function that stops it.
 * A failed request leaves the local choice in place; the next load takes the server's list.
 */
export function startMuteSync(getToken: () => AuthToken): () => void {
    return useAppStore.subscribe((state, previous) => {
        if (applyingRemoteState) return
        if (state.mutedServerIds === previous.mutedServerIds && state.mutedChannelIds === previous.mutedChannelIds) return
        const muted = {
            server_ids: difference(state.mutedServerIds, previous.mutedServerIds),
            channel_ids: difference(state.mutedChannelIds, previous.mutedChannelIds),
        }
        const unmuted = {
            server_ids: difference(previous.mutedServerIds, state.mutedServerIds),
            channel_ids: difference(previous.mutedChannelIds, state.mutedChannelIds),
        }
        const token = getToken()
        if (muted.server_ids.length || muted.channel_ids.length) {
            notificationApi.setMutes(muted, true, token).catch(() => {})
        }
        if (unmuted.server_ids.length || unmuted.channel_ids.length) {
            notificationApi.setMutes(unmuted, false, token).catch(() => {})
        }
    })
}
