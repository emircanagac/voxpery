import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Server, Channel, MemberInfo, Friend, DmChannel } from '../api'

interface AppState {
    // Servers
    servers: Server[]
    activeServerId: string | null
    setServers: (servers: Server[]) => void
    setActiveServer: (id: string | null) => void
    addServer: (server: Server) => void
    removeServer: (id: string) => void

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
    voiceControls: Record<string, { muted: boolean; deafened: boolean; screenSharing: boolean; cameraOn: boolean }>
    setVoiceControl: (userId: string, muted: boolean, deafened: boolean, screenSharing: boolean) => void
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
}

export const useAppStore = create<AppState>()(
    persist(
        (set) => ({
            // Servers
            servers: [],
            activeServerId: null,
            setServers: (servers) => set((s) => JSON.stringify(s.servers) === JSON.stringify(servers) ? s : { servers }),
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
                        } catch {}
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
            setVoiceControl: (userId, muted, deafened, screenSharing) =>
                set((s) => ({
                    voiceControls: {
                        ...s.voiceControls,
                        [userId]: {
                            muted,
                            deafened,
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
        }),
        {
            name: 'voxpery-app-storage',
            // Persist activeDmChannelId so Social tab restores the open DM (single path /). Do not persist dmUnread (stale badge).
            partialize: (s) => ({ activeDmChannelId: s.activeDmChannelId }),
        },
    ),
)
