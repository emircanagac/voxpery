import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { serverApi, channelApi, type Channel, type MessageWithAuthor, type WsEvent } from '../api'
import { useToastStore } from '../stores/toast'
import { withUpdatedAuthor } from '../messageAuthors'
import { applyMessageUpdate } from '../messageUpdates'
import { applyIncomingMessage } from '../messageResilience'
import { playMessageNotificationSound, shouldPlayNotificationSound } from '../notificationSound'
import { getServerNotificationPreference, shouldNotifyForServerMessage, shouldTrackServerUnread } from '../notificationPreferences'
import { isAppBackgrounded, shouldShowPushNotification, showPushNotification } from '../pushNotifications'
import { handleVoiceMemberMoveRequested } from '../webrtc/voiceMemberMove'
import { messageMentionsUser, removalNoticeFor, type UiMessage } from './appLayoutModel'
import type { useSocketStore } from '../stores/socket'

type AppState = ReturnType<typeof useAppStore.getState>

export interface AppLayoutEventContext {
    isViewActive: boolean | undefined
    channels: Channel[]
    channelsByServerId: Record<string, Channel[]>
    mutedChannelIds: AppState['mutedChannelIds']
    mutedServerIds: AppState['mutedServerIds']
    incrementServerMention: AppState['incrementServerMention']
    incrementServerUnread: AppState['incrementServerUnread']
    setActiveChannel: AppState['setActiveChannel']
    setActiveServer: AppState['setActiveServer']
    setChannels: AppState['setChannels']
    setChannelCategoriesForServer: (serverId: string, categories: string[]) => void
    setChannelPins: Dispatch<SetStateAction<MessageWithAuthor[]>>
    setChannelServerMap: Dispatch<SetStateAction<Record<string, string>>>
    setMessages: Dispatch<SetStateAction<UiMessage[]>>
    setMyServerPermissions: Dispatch<SetStateAction<Record<string, number>>>
    activeChannelIdRef: RefObject<string | null>
    activeServerIdRef: RefObject<string | null>
    channelServerMapRef: RefObject<Record<string, string>>
    messagesByChannelRef: RefObject<Record<string, UiMessage[]>>
    tokenRef: RefObject<string | null>
    user: ReturnType<typeof useAuthStore.getState>['user']
    send: ReturnType<typeof useSocketStore.getState>['send']
    pushToast: ReturnType<typeof useToastStore.getState>['pushToast']
}

/** Applies a server event to the open server, channel and message list. */
export function handleAppLayoutEvent(event: WsEvent, {
    isViewActive,
    channels,
    channelsByServerId,
    mutedChannelIds,
    mutedServerIds,
    incrementServerMention,
    incrementServerUnread,
    setActiveChannel,
    setActiveServer,
    setChannels,
    setChannelCategoriesForServer,
    setChannelPins,
    setChannelServerMap,
    setMessages,
    setMyServerPermissions,
    activeChannelIdRef,
    activeServerIdRef,
    channelServerMapRef,
    messagesByChannelRef,
    tokenRef,
    user,
    send,
    pushToast,
}: AppLayoutEventContext) {
    try {
        if (!event || typeof event.type !== 'string') return
        const refreshServerSnapshot = (sid: string, t: string | null, refreshChannels: boolean) => {
            const detailPromise = serverApi.get(sid, t)
            const channelsPromise = refreshChannels
                ? serverApi.channels(sid, t).catch(() => [] as Channel[])
                : Promise.resolve([] as Channel[])
            const categoriesPromise = refreshChannels
                ? channelApi.listCategories(sid, t).catch(() => [])
                : Promise.resolve([] as Array<{ name: string }>)
            Promise.all([detailPromise, channelsPromise, categoriesPromise])
                .then(([detail, chs, categories]) => {
                    const store = useAppStore.getState()
                    store.setMembersForServer(sid, detail.members ?? [])
                    if (activeServerIdRef.current === sid) {
                        store.setMembers(detail.members ?? [])
                    }
                    setMyServerPermissions((prev) => ({ ...prev, [detail.id]: detail.my_permissions ?? 0 }))

                    if (!refreshChannels) return
                    store.setChannelsForServer(sid, chs)
                    setChannelServerMap((prev) => {
                        const next = { ...prev }
                        for (const ch of chs) next[ch.id] = ch.server_id
                        return next
                    })
                    if (activeServerIdRef.current !== sid) return
                    const currentActive = activeChannelIdRef.current
                    const lostChannel = currentActive
                        ? useAppStore.getState().channels.find((c) => c.id === currentActive && c.server_id === sid)
                        : undefined
                    setChannels(chs)
                    setChannelCategoriesForServer(sid, categories.map((c) => c.name))
                    const stillValid = !!currentActive && chs.some((c) => c.id === currentActive)
                    if (!stillValid && lostChannel) {
                        useToastStore.getState().pushToast({
                            level: 'info',
                            title: 'Channel unavailable',
                            message: `#${lostChannel.name} is no longer available to you.`,
                        })
                    }
                    if (!stillValid) {
                        const target = chs.find((c) => c.channel_type === 'text')?.id ?? chs[0]?.id ?? null
                        store.setActiveChannel(target)
                    }
                })
                .catch(() => { })
        }
        switch (event.type) {
            case 'NewMessage': {
                const d = event.data
                const incomingChannelId = d.channel_id
                const incoming = d.message
                if (!incomingChannelId || !incoming) break
                const isCurrentVisibleChannel =
                    incomingChannelId === activeChannelIdRef.current
                    && isViewActive
                if (isCurrentVisibleChannel) {
                    setMessages((prev) => {
                        const next = applyIncomingMessage(prev, incoming, d.client_request_id, user?.id)
                        messagesByChannelRef.current[incomingChannelId] = next
                        return next
                    })
                } else {
                    const cached = messagesByChannelRef.current[incomingChannelId]
                    if (cached?.length && !cached.some((m) => m.id === incoming.id)) {
                        messagesByChannelRef.current[incomingChannelId] = [...cached, incoming]
                    }
                }
                // An open channel only reads its messages while the app is in the foreground.
                if (!isCurrentVisibleChannel || isAppBackgrounded()) {
                    if (incoming.author?.user_id !== user?.id) {
                        const incomingServerId = channelServerMapRef.current[incomingChannelId]
                        const isMention = messageMentionsUser(incoming.content, user?.username)
                        const isMutedServer = !!incomingServerId && mutedServerIds.includes(incomingServerId)
                        const isMutedChannel = mutedChannelIds.includes(incomingChannelId)
                        if (shouldTrackServerUnread({ isMention, isMutedServer, isMutedChannel })) {
                            incrementServerUnread(incomingChannelId)
                            if (isMention) {
                                incrementServerMention(incomingChannelId)
                            }
                        }

                        if (
                            incomingServerId
                            && shouldNotifyForServerMessage({
                                preference: getServerNotificationPreference(),
                                isMention,
                                isMutedServer,
                                isMutedChannel,
                            })
                        ) {
                            if (shouldPlayNotificationSound(user?.status)) {
                                playMessageNotificationSound()
                            }
                            if (shouldShowPushNotification(user?.status)) {
                                const channelName =
                                    channelsByServerId[incomingServerId]?.find((channel) => channel.id === incomingChannelId)?.name
                                    ?? channels.find((channel) => channel.id === incomingChannelId)?.name
                                    ?? 'channel'
                                showPushNotification({
                                    title: isMention ? `Mention in #${channelName}` : `New message in #${channelName}`,
                                    body: `${incoming.author?.username ?? 'Someone'}: ${incoming.content.slice(0, 120)}`,
                                    tag: `server:${incomingServerId}:channel:${incomingChannelId}`,
                                    onClick: () => {
                                        setActiveServer(incomingServerId)
                                        setActiveChannel(incomingChannelId)
                                    },
                                })
                            }
                        }
                    }
                }
                break
            }
            case 'MessageDeleted': {
                const d = event.data
                const channelId = d.channel_id
                const messageId = d.message_id
                if (!channelId || !messageId) break
                if (channelId === activeChannelIdRef.current) {
                    setMessages((prev) => prev.filter((m) => m.id !== messageId))
                }
                const cached = messagesByChannelRef.current[channelId]
                if (cached) {
                    messagesByChannelRef.current[channelId] = cached.filter((m) => m.id !== messageId)
                }
                break
            }
            case 'MessageUpdated': {
                const d = event.data
                const channelId = d.channel_id
                const message = d.message
                if (!channelId || !message?.id) break
                const update = (m: UiMessage) => (m.id === message.id
                    ? applyMessageUpdate(m, message, d.viewer_id, user?.id)
                    : m)
                if (channelId === activeChannelIdRef.current) {
                    setMessages((prev) => prev.map(update))
                }
                const cached = messagesByChannelRef.current[channelId]
                if (cached) {
                    messagesByChannelRef.current[channelId] = cached.map(update)
                }
                break
            }
            case 'PresenceUpdate': {
                const d = event.data
                const user_id = d.user_id
                const status = d.status
                if (!user_id || !status) break
                const store = useAppStore.getState()

                const members = store.members ?? []
                if (members.some((m) => m.user_id === user_id)) {
                    store.setMembers(members.map((m) => m.user_id === user_id ? { ...m, status } : m))
                }

                Object.entries(store.membersByServerId ?? {}).forEach(([sid, cache]) => {
                    if (cache.some((m) => m.user_id === user_id)) {
                        store.setMembersForServer(sid, cache.map((m) => m.user_id === user_id ? { ...m, status } : m))
                    }
                })
                break
            }
            case 'UserUpdated': {
                const d = event.data
                const updated = d.user
                const user_id = updated?.id
                if (!user_id) break
                const store = useAppStore.getState()

                // Messages carry a copy of their author; refresh it in the open channel,
                // every cached channel and the pinned list.
                const profile = { id: user_id, username: updated.username, avatar_url: updated.avatar_url ?? null }
                setMessages((prev) => withUpdatedAuthor(prev, profile))
                Object.entries(messagesByChannelRef.current).forEach(([cachedChannelId, cached]) => {
                    messagesByChannelRef.current[cachedChannelId] = withUpdatedAuthor(cached, profile)
                })
                setChannelPins((prev) => withUpdatedAuthor(prev, profile))

                const members = store.members ?? []
                if (members.some((m) => m.user_id === user_id)) {
                    store.setMembers(
                        members.map((m) =>
                            m.user_id === user_id
                                ? {
                                    ...m,
                                    username: updated.username ?? m.username,
                                    avatar_url: updated.avatar_url ?? null,
                                    status: updated.status ?? m.status,
                                }
                                : m,
                        ),
                    )
                }

                Object.entries(store.membersByServerId ?? {}).forEach(([sid, cache]) => {
                    if (!cache.some((m) => m.user_id === user_id)) return
                    store.setMembersForServer(
                        sid,
                        cache.map((m) =>
                            m.user_id === user_id
                                ? {
                                    ...m,
                                    username: updated.username ?? m.username,
                                    avatar_url: updated.avatar_url ?? null,
                                    status: updated.status ?? m.status,
                                }
                                : m,
                        ),
                    )
                })
                break
            }
            case 'MemberJoined': {
                const d = event.data
                const eventSid = d.server_id
                if (!eventSid) break
                const t = tokenRef.current ?? null
                refreshServerSnapshot(eventSid, t, false)
                break
            }
            case 'MemberRoleUpdated': {
                const d = event.data
                const sid = d.server_id
                if (!sid) break
                const t = tokenRef.current ?? null
                refreshServerSnapshot(sid, t, true)
                break
            }
            case 'MemberTimeoutUpdated': {
                const d = event.data
                if (!d.server_id || !d.user_id) break
                const store = useAppStore.getState()
                const withTimeout = (list: typeof store.members) => list.map((member) => (
                    member.user_id === d.user_id ? { ...member, timed_out_until: d.timed_out_until } : member
                ))
                if (activeServerIdRef.current === d.server_id) store.setMembers(withTimeout(store.members ?? []))
                const cached = store.membersByServerId[d.server_id] ?? []
                if (cached.length > 0) store.setMembersForServer(d.server_id, withTimeout(cached))
                break
            }
            case 'ServerRolesUpdated': {
                const d = event.data
                const sid = d.server_id
                if (!sid) break
                const t = tokenRef.current ?? null
                refreshServerSnapshot(sid, t, true)
                break
            }
            case 'ServerUpdated': {
                const d = event.data
                if (!d.server_id) break
                const store = useAppStore.getState()
                if (!store.servers.some((server) => server.id === d.server_id)) break
                store.setServers(store.servers.map((server) => (server.id === d.server_id
                    ? {
                        ...server,
                        name: d.name,
                        icon_url: d.icon_url ?? undefined,
                        description: d.description ?? undefined,
                    }
                    : server)))
                break
            }
            case 'ServerChannelsUpdated': {
                const d = event.data
                const sid = d.server_id
                if (!sid) break
                const t = tokenRef.current ?? null
                refreshServerSnapshot(sid, t, true)
                break
            }
            case 'MemberLeft': {
                const d = event.data
                const leftUserId = d.user_id
                const sid = d.server_id
                if (!leftUserId || !sid) break
                const store = useAppStore.getState()
                if (leftUserId === useAuthStore.getState().user?.id) {
                    // This account was kicked, banned or left elsewhere: drop the server
                    // instead of keeping its channels and composer on screen.
                    const serverName = store.servers.find((server) => server.id === sid)?.name
                    const removalNotice = serverName && removalNoticeFor(d.reason, serverName)
                    if (removalNotice) useToastStore.getState().pushToast({ level: 'info', ...removalNotice })
                    const remaining = store.servers.filter((server) => server.id !== sid)
                    store.setServers(remaining)
                    if (activeServerIdRef.current === sid) store.setActiveServer(remaining[0]?.id ?? null)
                    break
                }
                const filterList = (list: typeof store.members) => list.filter((m) => m.user_id !== leftUserId)

                if (activeServerIdRef.current === sid) {
                    store.setMembers(filterList(store.members ?? []))
                }
                const cached = store.membersByServerId[sid] ?? []
                if (cached.length > 0) {
                    store.setMembersForServer(sid, filterList(cached))
                }
                break
            }
            case 'VoiceStateUpdate': {
                const d = event.data
                const channel_id = d.channel_id
                const user_id = d.user_id
                const server_id = d.server_id
                const channel_active_since_ms = d.channel_active_since_ms
                if (!user_id) break
                const store = useAppStore.getState()
                store.setVoiceState(user_id, channel_id ?? null, channel_active_since_ms ?? null)
                store.setVoiceStateServerId(user_id, server_id ?? null)
                if (server_id && channel_id) {
                    const activeMembers = activeServerIdRef.current === server_id ? (store.members ?? []) : []
                    const cachedMembers = store.membersByServerId[server_id] ?? []
                    const knowsMember =
                        activeMembers.some((m) => m.user_id === user_id)
                        || cachedMembers.some((m) => m.user_id === user_id)
                    if (!knowsMember) {
                        const t = tokenRef.current ?? null
                        refreshServerSnapshot(server_id, t, false)
                    }
                }
                break
            }
            case 'VoiceControlUpdate': {
                const d = event.data
                const user_id = d.user_id
                const muted = d.muted
                const deafened = d.deafened
                const server_muted = d.server_muted
                const server_deafened = d.server_deafened
                const screen_sharing = d.screen_sharing
                const camera_on = d.camera_on
                if (!user_id) break
                const store = useAppStore.getState()
                store.setVoiceControl(
                    user_id,
                    !!muted,
                    !!deafened,
                    !!screen_sharing,
                    !!server_muted,
                    !!server_deafened,
                )
                store.setVoiceCamera(user_id, !!camera_on)
                break
            }
            case 'VoiceMemberMoveRequested': {
                const d = event.data
                const requestId = d.request_id
                const sourceChannelId = d.source_channel_id
                const channelId = d.channel_id
                if (!requestId || !sourceChannelId || !channelId) break
                const joinVoice = (window as Window & {
                    __voxperyJoinVoice?: (targetChannelId: string) => Promise<void>
                }).__voxperyJoinVoice
                void handleVoiceMemberMoveRequested(
                    {
                        requestId,
                        sourceChannelId,
                        destinationChannelId: channelId,
                    },
                    {
                        getJoinedVoiceChannelId: () => useAppStore.getState().joinedVoiceChannelId,
                        joinVoice,
                        send,
                        onError: (message) => pushToast({
                            level: 'error',
                            title: 'Voice move failed',
                            message,
                        }),
                    },
                )
                break
            }
            case 'VoiceMemberMoveResult': {
                const d = event.data
                const success = d.success === true
                if (!success) {
                    pushToast({
                        level: 'error',
                        title: 'Voice move failed',
                        message: typeof d.message === 'string'
                            ? d.message
                            : 'The member could not be moved.',
                    })
                }
                break
            }
        }
    } catch (err) {
        console.error('AppLayout WS handler error:', err)
    }
}
