import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Server, Channel, MemberInfo, Friend, DmChannel } from '../api'

interface AppState {
    // Servers
    servers: Server[]
    activeServerId: string | null
    serversLoading: boolean
    setServers: (servers: Server[]) => void
    setServersLoading: (loading: boolean) => void
    setActiveServer: (id: string | null) => void
    addServer: (server: Server) => void
    removeServer: (id: string) => void
    mutedServerIds: string[]
    toggleMutedServer: (serverId: string) => void
    setMutedServer: (serverId: string, muted: boolean) => void

    // Channels (current + cache per server for instant switch-back)
    channels: Channel[]
    activeChannelId: string | null
    setChannels: (channels: Channel[]) => void
    setActiveChannel: (id: string | null) => void
    channelsByServerId: Record<string, Channel[]>
    membersByServerId: Record<string, MemberInfo[]>
    setChannelsForServer: (serverId: string, channels: Channel[]) => void
    setMembersForServer: (serverId: string, members: MemberInfo[]) => void

    // Members
    members: MemberInfo[]
    setMembers: (members: MemberInfo[]) => void

    // DM state shared across routes
    dmChannelIds: string[]
    setDmChannelIds: (ids: string[]) => void
    activeDmChannelId: string | null
    setActiveDmChannelId: (id: string | null) => void
    // Prefetched for Social (friends + DM channel list) so Social loads instantly
    friends: Friend[]
    dmChannels: DmChannel[]
    setFriends: (friends: Friend[]) => void
    setDmChannels: (channels: DmChannel[]) => void
    dmUnread: Record<string, number>
    incrementDmUnread: (channelId: string) => void
    clearDmUnread: (channelId: string) => void
    serverUnreadByChannel: Record<string, number>
    incrementServerUnread: (channelId: string) => void
    clearServerUnread: (channelId: string) => void
    incomingRequestCount: number
    setIncomingRequestCount: (count: number) => void
    resetIncomingRequestCount: () => void

    // Voice presence (user_id -> channel_id | null)
    voiceStates: Record<string, string | null>
    setVoiceState: (userId: string, channelId: string | null) => void
    // Voice presence: user_id -> server_id when in a voice channel (null when left)
    voiceStateServerIds: Record<string, string | null>
    setVoiceStateServerId: (userId: string, serverId: string | null) => void
    // Voice control state (user_id -> mute/deafen)
    voiceControls: Record<string, { muted: boolean; deafened: boolean; serverMuted: boolean; serverDeafened: boolean; screenSharing: boolean; cameraOn: boolean }>
    setVoiceControl: (userId: string, muted: boolean, deafened: boolean, screenSharing: boolean, serverMuted?: boolean, serverDeafened?: boolean) => void
    setVoiceCamera: (userId: string, cameraOn: boolean) => void

    // Voice speaking (for is-speaking halo)
    voiceSpeakingUserIds: string[]
    voiceLocalSpeaking: boolean
    setVoiceSpeaking: (userIds: string[], local: boolean) => void

    // Voice channel we are currently in (stays set when navigating to Social so call does not drop)
    joinedVoiceChannelId: string | null
    setJoinedVoiceChannelId: (id: string | null) => void
    // Modals
    showCreateServer: boolean
    showJoinServer: boolean
    setShowCreateServer: (show: boolean) => void
    setShowJoinServer: (show: boolean) => void
    /** When set, AppLayout opens server settings for this server (then clears). Used from unified sidebar. */
    openServerSettingsForServerId: string | null
    setOpenServerSettingsForServerId: (id: string | null) => void
    mobileSidebarPanel: 'none' | 'social' | 'channels'
    setMobileSidebarPanel: (panel: 'none' | 'social' | 'channels') => void
    closeMobileSidebar: () => void
    resetSessionState: () => void
}

export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            // Servers
            servers: [],
            activeServerId: null,
            serversLoading: false,
            setServers: (servers) => set((s) => JSON.stringify(s.servers) === JSON.stringify(servers) ? s : { servers }),
            setServersLoading: (loading) => set({ serversLoading: loading }),
            setActiveServer: (id) =>
                set((s) => {
                    if (s.activeServerId === id) return s
                    if (!id) {
                        return { activeServerId: null, activeChannelId: null, channels: [], members: [] }
                    }
                    const cachedChannels = s.channelsByServerId[id] ?? []
                    const cachedMembers = s.membersByServerId[id] ?? []
                    const hasCache = cachedChannels.length > 0
                    
                    let defaultChannelId = null
                    if (hasCache) {
                        let stored = null
                        try {
                            const raw = sessionStorage.getItem('voxpery-last-channel-ids')
                            if (raw) stored = (JSON.parse(raw) as Record<string, string>)[id] || null
                        } catch {
                            stored = null
                        }
                        if (stored && cachedChannels.some(c => c.id === stored)) {
                            defaultChannelId = stored
                        } else {
                            defaultChannelId = cachedChannels.find((c) => c.channel_type === 'text')?.id ?? cachedChannels[0]?.id ?? null
                        }
                    }

                    return {
                        activeServerId: id,
                        channels: cachedChannels,
                        members: cachedMembers,
                        activeChannelId: defaultChannelId,
                    }
                }),
            addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
            removeServer: (id) => set((s) => ({ servers: s.servers.filter((srv) => srv.id !== id) })),
            mutedServerIds: [],
            toggleMutedServer: (serverId) =>
                set((s) => {
                    const isMuted = s.mutedServerIds.includes(serverId)
                    return {
                        mutedServerIds: isMuted
                            ? s.mutedServerIds.filter((id) => id !== serverId)
                            : [...s.mutedServerIds, serverId],
                    }
                }),
            setMutedServer: (serverId, muted) =>
                set((s) => ({
                    mutedServerIds: muted
                        ? (s.mutedServerIds.includes(serverId) ? s.mutedServerIds : [...s.mutedServerIds, serverId])
                        : s.mutedServerIds.filter((id) => id !== serverId),
                })),

            // Channels
            channels: [],
            activeChannelId: null,
            setChannels: (channels) => set((s) => JSON.stringify(s.channels) === JSON.stringify(channels) ? s : { channels }),
            setActiveChannel: (id) => set({ activeChannelId: id }),
            channelsByServerId: {},
            membersByServerId: {},
            setChannelsForServer: (serverId, channels) =>
                set((s) => JSON.stringify(s.channelsByServerId[serverId]) === JSON.stringify(channels) ? s : { channelsByServerId: { ...s.channelsByServerId, [serverId]: channels } }),
            setMembersForServer: (serverId, members) =>
                set((s) => JSON.stringify(s.membersByServerId[serverId]) === JSON.stringify(members) ? s : { membersByServerId: { ...s.membersByServerId, [serverId]: members } }),

            // Members
            members: [],
            setMembers: (members) => set((s) => JSON.stringify(s.members) === JSON.stringify(members) ? s : { members }),

            // DM
            dmChannelIds: [],
            setDmChannelIds: (ids) => set((s) => JSON.stringify(s.dmChannelIds) === JSON.stringify(ids) ? s : { dmChannelIds: ids }),
            activeDmChannelId: null,
            setActiveDmChannelId: (id) => set({ activeDmChannelId: id }),
            friends: [],
            dmChannels: [],
            setFriends: (friends) => set((s) => JSON.stringify(s.friends) === JSON.stringify(friends) ? s : { friends }),
            setDmChannels: (channels) => set((s) => JSON.stringify(s.dmChannels) === JSON.stringify(channels) ? s : { dmChannels: channels }),
            dmUnread: {},
            incrementDmUnread: (channelId) =>
                set((s) => ({ dmUnread: { ...s.dmUnread, [channelId]: (s.dmUnread[channelId] ?? 0) + 1 } })),
            clearDmUnread: (channelId) =>
                set((s) => ({ dmUnread: { ...s.dmUnread, [channelId]: 0 } })),
            serverUnreadByChannel: {},
            incrementServerUnread: (channelId) =>
                set((s) => ({
                    serverUnreadByChannel: {
                        ...s.serverUnreadByChannel,
                        [channelId]: (s.serverUnreadByChannel[channelId] ?? 0) + 1,
                    },
                })),
            clearServerUnread: (channelId) =>
                set((s) => {
                    if (!s.serverUnreadByChannel[channelId]) return s
                    const next = { ...s.serverUnreadByChannel }
                    delete next[channelId]
                    return { serverUnreadByChannel: next }
                }),
            incomingRequestCount: 0,
            setIncomingRequestCount: (count) => set({ incomingRequestCount: Math.max(0, count) }),
            resetIncomingRequestCount: () => set({ incomingRequestCount: 0 }),

            // Voice presence
            voiceStates: {},
            setVoiceState: (userId, channelId) =>
                set((s) => ({
                    voiceStates: { ...s.voiceStates, [userId]: channelId },
                })),
            voiceStateServerIds: {},
            setVoiceStateServerId: (userId, serverId) =>
                set((s) => ({
                    voiceStateServerIds: { ...s.voiceStateServerIds, [userId]: serverId },
                })),
            voiceControls: {},
            setVoiceControl: (userId, muted, deafened, screenSharing, serverMuted, serverDeafened) =>
                set((s) => ({
                    voiceControls: {
                        ...s.voiceControls,
                        [userId]: {
                            muted,
                            deafened,
                            serverMuted: serverMuted ?? s.voiceControls[userId]?.serverMuted ?? false,
                            serverDeafened: serverDeafened ?? s.voiceControls[userId]?.serverDeafened ?? false,
                            screenSharing,
                            cameraOn: s.voiceControls[userId]?.cameraOn ?? false,
                        },
                    },
                })),
            setVoiceCamera: (userId, cameraOn) =>
                set((s) => ({
                    voiceControls: {
                        ...s.voiceControls,
                        [userId]: {
                            muted: s.voiceControls[userId]?.muted ?? false,
                            deafened: s.voiceControls[userId]?.deafened ?? false,
                            serverMuted: s.voiceControls[userId]?.serverMuted ?? false,
                            serverDeafened: s.voiceControls[userId]?.serverDeafened ?? false,
                            screenSharing: s.voiceControls[userId]?.screenSharing ?? false,
                            cameraOn,
                        },
                    },
                })),

            // Voice speaking
            voiceSpeakingUserIds: [],
            voiceLocalSpeaking: false,
            setVoiceSpeaking: (userIds, local) =>
                set({ voiceSpeakingUserIds: userIds, voiceLocalSpeaking: local }),

            // Voice channel we are in (persists across route changes)
            joinedVoiceChannelId: null,
            setJoinedVoiceChannelId: (id) => set({ joinedVoiceChannelId: id }),

            // Modals
            showCreateServer: false,
            showJoinServer: false,
            setShowCreateServer: (show) => set({ showCreateServer: show }),
            setShowJoinServer: (show) => set({ showJoinServer: show }),
            openServerSettingsForServerId: null,
            setOpenServerSettingsForServerId: (id) => set({ openServerSettingsForServerId: id }),
            mobileSidebarPanel: 'none',
            setMobileSidebarPanel: (panel) => set({ mobileSidebarPanel: panel }),
            closeMobileSidebar: () => set({ mobileSidebarPanel: 'none' }),
            resetSessionState: () =>
                set({
                    servers: [],
                    activeServerId: null,
                    serversLoading: false,
                    channels: [],
                    activeChannelId: null,
                    channelsByServerId: {},
                    membersByServerId: {},
                    members: [],
                    dmChannelIds: [],
                    activeDmChannelId: null,
                    friends: [],
                    dmChannels: [],
                    dmUnread: {},
                    serverUnreadByChannel: {},
                    incomingRequestCount: 0,
                    voiceStates: {},
                    voiceStateServerIds: {},
                    voiceControls: {},
                    voiceSpeakingUserIds: [],
                    voiceLocalSpeaking: false,
                    joinedVoiceChannelId: null,
                    showCreateServer: false,
                    showJoinServer: false,
                    openServerSettingsForServerId: null,
                    mobileSidebarPanel: 'none',
                }),
        }),
        {
            name: 'voxpery-app-storage',
            // Persist lightweight navigation + unread state so refresh doesn't silently clear routing cues.
            partialize: (s) => ({
                activeDmChannelId: s.activeDmChannelId,
                dmUnread: s.dmUnread,
                serverUnreadByChannel: s.serverUnreadByChannel,
                mutedServerIds: s.mutedServerIds,
            }),
        },
    ),
)
