import { Profiler, useEffect, useState, useRef, useCallback, useMemo, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useSocketStore } from '../stores/socket'
import { serverApi, messageApi, channelApi, dmApi, friendApi, type MessageWithAuthor, type Channel, type ServerRole, type AuditLogEntry, type ServerBanEntry } from '../api'
import ServerSidebar from '../components/ServerSidebar'
import ChannelSidebar from '../components/ChannelSidebar'
import ChannelSettingsModal from '../components/ChannelSettingsModal'
import CategoryPermissionsModal from '../components/CategoryPermissionsModal'
import ChatArea from '../components/ChatArea'
import MemberSidebar from '../components/MemberSidebar'
import ServerSettingsAuditLog from '../components/ServerSettingsAuditLog'
import ServerRolesSidebar from '../components/ServerRolesSidebar'
import ServerRoleEditor from '../components/ServerRoleEditor'
import { useToastStore } from '../stores/toast'
import { MessageSquare, Mic } from 'lucide-react'

type UiMessage = MessageWithAuthor & {
    clientId?: string
    clientStatus?: 'sending' | 'failed'
    clientError?: string
}

export interface AppLayoutProps {
    /** When true, do not render ServerSidebar (used inside UnifiedLayout which has its own sidebar). */
    skipServerSidebar?: boolean
    /** When true, the server chat view is visible (e.g. user switched from DM to Servers); used to scroll to bottom on re-enter. */
    isViewActive?: boolean
}

/** Max size per file for chat attachments. Kept conservative to limit abuse; server body limit is 10 MiB. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
/** Page size for message list (pagination). Must match backend max (100) or less. */
const MESSAGE_PAGE_SIZE = 50
const CHANNEL_NAME_MAX = 32
const CATEGORY_NAME_MAX = 32

// Permission bit masks (must stay in sync with backend Permissions flags).
const PERM_VIEW_SERVER = 1 << 0
const PERM_MANAGE_SERVER = 1 << 1
const PERM_MANAGE_ROLES = 1 << 2
const PERM_MANAGE_CHANNELS = 1 << 3
const PERM_KICK_MEMBERS = 1 << 4
const PERM_BAN_MEMBERS = 1 << 5
const PERM_VIEW_AUDIT_LOG = 1 << 6
const PERM_SEND_MESSAGES = 1 << 7
const PERM_MANAGE_MESSAGES = 1 << 8
const PERM_MANAGE_PINS = 1 << 9
const PERM_CONNECT_VOICE = 1 << 10
const PERM_MUTE_MEMBERS = 1 << 11
const PERM_DEAFEN_MEMBERS = 1 << 12

const LAST_CHANNELS_STORAGE_KEY = 'voxpery-last-channel-ids'

function validateChannelNameInput(raw: string): string | null {
    const value = raw.trim()
    if (!value) return 'Channel name is required.'
    if (Array.from(value).length > CHANNEL_NAME_MAX) {
        return `Channel name must be ${CHANNEL_NAME_MAX} characters or fewer.`
    }
    if (!/^[\p{L}\p{N}_ -]+$/u.test(value)) {
        return "Channel name can only include letters, numbers, spaces, '-' and '_'."
    }
    if (value.includes('  ')) {
        return 'Channel name cannot contain consecutive spaces.'
    }
    return null
}

function validateCategoryNameInput(raw: string): string | null {
    const value = raw.trim()
    if (!value) return 'Category name is required.'
    if (Array.from(value).length > CATEGORY_NAME_MAX) {
        return `Category name must be ${CATEGORY_NAME_MAX} characters or fewer.`
    }
    if (!/^[\p{L}\p{N}_ -]+$/u.test(value)) {
        return "Category name can only include letters, numbers, spaces, '-' and '_'."
    }
    if (value.includes('  ')) {
        return 'Category name cannot contain consecutive spaces.'
    }
    return null
}

function channelTypeOrder(type: Channel['channel_type']): number {
    return type === 'text' ? 0 : 1
}

function compareChannelsForSidebar(a: Channel, b: Channel): number {
    const aCat = a.category ?? 'Channels'
    const bCat = b.category ?? 'Channels'
    if (aCat !== bCat) return aCat.localeCompare(bCat)
    const typeDiff = channelTypeOrder(a.channel_type) - channelTypeOrder(b.channel_type)
    if (typeDiff !== 0) return typeDiff
    return a.position - b.position
}

function getStoredChannelId(serverId: string): string | null {
    try {
        const raw = sessionStorage.getItem(LAST_CHANNELS_STORAGE_KEY)
        if (!raw) return null
        const map = JSON.parse(raw) as Record<string, string>
        return map[serverId] || null
    } catch {
        return null
    }
}

function setStoredChannelId(serverId: string, channelId: string | null) {
    try {
        const raw = sessionStorage.getItem(LAST_CHANNELS_STORAGE_KEY)
        const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
        if (channelId) map[serverId] = channelId
        else delete map[serverId]
        sessionStorage.setItem(LAST_CHANNELS_STORAGE_KEY, JSON.stringify(map))
    } catch {
        // ignore
    }
}

export default function AppLayout({ skipServerSidebar = false, isViewActive }: AppLayoutProps) {
    const MAX_IMAGE_BYTES = 2 * 1024 * 1024
    const { token, user } = useAuthStore()
    const navigate = useNavigate()
    const {
        servers, activeServerId, activeChannelId, channels, members,
        setServers, setActiveServer, setActiveChannel, setChannels, setMembers,
        setChannelsForServer, setMembersForServer,
        friends, setFriends,
        dmChannels, setDmChannels, setActiveDmChannelId, setDmChannelIds,
        voiceControls,
        setShowCreateServer, setShowJoinServer,
        showCreateServer, showJoinServer,
        openServerSettingsForServerId,
        setOpenServerSettingsForServerId,
    } = useAppStore(
        useShallow((s) => ({
            servers: s.servers,
            activeServerId: s.activeServerId,
            activeChannelId: s.activeChannelId,
            channels: s.channels,
            members: s.members,
            setServers: s.setServers,
            setActiveServer: s.setActiveServer,
            setActiveChannel: s.setActiveChannel,
            setChannels: s.setChannels,
            setMembers: s.setMembers,
            setChannelsForServer: s.setChannelsForServer,
            setMembersForServer: s.setMembersForServer,
            friends: s.friends,
            setFriends: s.setFriends,
            dmChannels: s.dmChannels,
            setDmChannels: s.setDmChannels,
            setActiveDmChannelId: s.setActiveDmChannelId,
            setDmChannelIds: s.setDmChannelIds,
            voiceControls: s.voiceControls,
            setShowCreateServer: s.setShowCreateServer,
            setShowJoinServer: s.setShowJoinServer,
            showCreateServer: s.showCreateServer,
            showJoinServer: s.showJoinServer,
            openServerSettingsForServerId: s.openServerSettingsForServerId,
            setOpenServerSettingsForServerId: s.setOpenServerSettingsForServerId,
        }))
    )

    const [messages, setMessages] = useState<UiMessage[]>([])
    const [messageInput, setMessageInput] = useState('')
    const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; contentSnippet: string } | null>(null)
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
    const [editingContent, setEditingContent] = useState('')
    const [editingReplyQuotePart, setEditingReplyQuotePart] = useState<string | null>(null)
    const [draftAttachments, setDraftAttachments] = useState<Array<{ name: string; url: string; size: number; type: string }>>([])
    const [newServerName, setNewServerName] = useState('')
    const [inviteCode, setInviteCode] = useState('')
    const [createServerError, setCreateServerError] = useState<string | null>(null)
    const [joinServerError, setJoinServerError] = useState<string | null>(null)
    const [showServerSettings, setShowServerSettings] = useState(false)
    const [serverSettingsServerId, setServerSettingsServerId] = useState<string | null>(null)
    const [serverSettingsTab, setServerSettingsTab] = useState<'overview' | 'roles' | 'audit' | 'bans' | 'danger'>('overview')
    const [serverSettingsName, setServerSettingsName] = useState('')
    const [serverSettingsIconDraft, setServerSettingsIconDraft] = useState<string | null | undefined>(undefined)
    const [serverSettingsError, setServerSettingsError] = useState<string | null>(null)
    const [showDeleteServerConfirm, setShowDeleteServerConfirm] = useState(false)
    const [deleteServerInput, setDeleteServerInput] = useState('')
    const [deleteServerError, setDeleteServerError] = useState<string | null>(null)
    const [showCreateChannel, setShowCreateChannel] = useState(false)
    const [showCreateCategory, setShowCreateCategory] = useState(false)
    const [createChannelName, setCreateChannelName] = useState('')
    const [createChannelType, setCreateChannelType] = useState<'text' | 'voice'>('text')
    const [createChannelCategory, setCreateChannelCategory] = useState('')
    const [createChannelError, setCreateChannelError] = useState<string | null>(null)
    const [createCategoryName, setCreateCategoryName] = useState('')
    const [createCategoryError, setCreateCategoryError] = useState<string | null>(null)
    const [channelCategories, setChannelCategories] = useState<string[]>([])
    const [categoryPermissionsTarget, setCategoryPermissionsTarget] = useState<string | null>(null)
    const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState<string | null>(null)
    const [deleteCategoryError, setDeleteCategoryError] = useState<string | null>(null)
    const [showRenameCategory, setShowRenameCategory] = useState(false)
    const [renameCategoryFrom, setRenameCategoryFrom] = useState<string | null>(null)
    const [renameCategoryName, setRenameCategoryName] = useState('')
    const [renameCategoryError, setRenameCategoryError] = useState<string | null>(null)
    const [showRenameChannel, setShowRenameChannel] = useState(false)
    const [renameChannelId, setRenameChannelId] = useState<string | null>(null)
    const [renameChannelName, setRenameChannelName] = useState('')
    const [renameChannelError, setRenameChannelError] = useState<string | null>(null)
    const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({})
    const [, setChannelServerMap] = useState<Record<string, string>>({})
    const [deleteMessageConfirmId, setDeleteMessageConfirmId] = useState<string | null>(null)
    const [deleteChannelConfirm, setDeleteChannelConfirm] = useState<Channel | null>(null)
    const [channelSettingsTarget, setChannelSettingsTarget] = useState<Channel | null>(null)
    const [copiedInvite, setCopiedInvite] = useState<'link' | 'code' | null>(null)
    const [hasMoreOlder, setHasMoreOlder] = useState(true)
    const [loadingOlder, setLoadingOlder] = useState(false)
    const [channelSearch, setChannelSearch] = useState('')
    const [channelSearchResults, setChannelSearchResults] = useState<MessageWithAuthor[] | null>(null)
    const [channelPins, setChannelPins] = useState<MessageWithAuthor[]>([])
    const messagesScrollRef = useRef<HTMLDivElement | null>(null)
    const pushToast = useToastStore((s) => s.pushToast)
    const { connect, send, subscribe, isConnected } = useSocketStore()
    const [showUnsavedServerSettingsConfirm, setShowUnsavedServerSettingsConfirm] = useState(false)
    const [serverRoles, setServerRoles] = useState<ServerRole[]>([])
    const [visibleRoleCount, setVisibleRoleCount] = useState(40)
    const [rolesLoading, setRolesLoading] = useState(false)
    const [rolesError, setRolesError] = useState<string | null>(null)
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
    const [draggingRoleId, setDraggingRoleId] = useState<string | null>(null)
    const [roleEditName, setRoleEditName] = useState('')
    const [roleEditPermissions, setRoleEditPermissions] = useState(0)
    const [roleEditPreAdminPermissions, setRoleEditPreAdminPermissions] = useState<number | null>(null)
    const [roleEditColor, setRoleEditColor] = useState<string | null>(null)
    const [deleteRoleConfirmId, setDeleteRoleConfirmId] = useState<string | null>(null)
    const [auditLogEntries, setAuditLogEntries] = useState<AuditLogEntry[] | null>(null)
    const [auditLogLoading, setAuditLogLoading] = useState(false)
    const [auditLogError, setAuditLogError] = useState<string | null>(null)
    const [banEntries, setBanEntries] = useState<ServerBanEntry[] | null>(null)
    const [banEntriesLoading, setBanEntriesLoading] = useState(false)
    const [banEntriesError, setBanEntriesError] = useState<string | null>(null)
    const [unbanInFlightUserId, setUnbanInFlightUserId] = useState<string | null>(null)
    const memberUsernameById = useMemo(() => {
        const byId = new Map<string, string>()
        for (const member of members) byId.set(member.user_id, member.username)
        return byId
    }, [members])
    const visibleServerRoles = useMemo(
        () => serverRoles.slice(0, Math.min(visibleRoleCount, serverRoles.length)),
        [serverRoles, visibleRoleCount]
    )
    const hasMoreServerRoles = visibleServerRoles.length < serverRoles.length

    // Refs to avoid stale closures in WebSocket handlers
    const activeChannelIdRef = useRef(activeChannelId)
    const activeServerIdRef = useRef(activeServerId)
    const tokenRef = useRef(token)
    const selectedRoleIdRef = useRef<string | null>(selectedRoleId)
    const serverIconInputRef = useRef<HTMLInputElement | null>(null)
    const messagesByChannelRef = useRef<Record<string, UiMessage[]>>({})

    useEffect(() => { activeChannelIdRef.current = activeChannelId }, [activeChannelId])
    useEffect(() => { activeServerIdRef.current = activeServerId }, [activeServerId])
    useEffect(() => { tokenRef.current = token }, [token])
    useEffect(() => { selectedRoleIdRef.current = selectedRoleId }, [selectedRoleId])

    useEffect(() => {
        setEditingMessageId(null)
        setEditingContent('')
        setEditingReplyQuotePart(null)
        setReplyingTo(null)
    }, [activeChannelId])

    // ─── Data Fetching ─────────────────────────
    // Use user (not token) so web works: on web token is null and auth is via httpOnly cookie.
    const isLoggedIn = !!user

    useEffect(() => {
        if (!isLoggedIn) return
        serverApi.list(token).then(setServers).catch(console.error)
    }, [isLoggedIn, token, setServers])

    useEffect(() => {
        if (!isLoggedIn) return
        friendApi.list(token).then(setFriends).catch(() => { })
    }, [isLoggedIn, token, setFriends])

    // Auto-select a default server (prefer the Voxpery default server) when logging in.
    useEffect(() => {
        if (!isLoggedIn) return
        if (activeServerId || servers.length === 0) return
        const preferred = servers.find((s) => s.invite_code === 'voxpery' || s.name === 'Voxpery') || servers[0]
        if (preferred) {
            setActiveServer(preferred.id)
        }
    }, [activeServerId, servers, setActiveServer, isLoggedIn])

    // When unified sidebar requested server settings for this server, open the modal.
    useEffect(() => {
        if (!openServerSettingsForServerId || openServerSettingsForServerId !== activeServerId) return
        setServerSettingsServerId(activeServerId)
        setShowServerSettings(true)
        setOpenServerSettingsForServerId(null)
    }, [activeServerId, openServerSettingsForServerId, setOpenServerSettingsForServerId])

    useEffect(() => {
        if (!activeServerId || !isLoggedIn) return
        const serverId = activeServerId
        Promise.all([
            serverApi.channels(serverId, token),
            channelApi.listCategories(serverId, token).catch(() => []),
        ]).then(([chs, categories]) => {
            setChannels(chs)
            setChannelsForServer(serverId, chs)
            setChannelCategories(categories.map((c) => c.name))
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            const currentActive = activeChannelIdRef.current
            const stillValid = !!currentActive && chs.some((c) => c.id === currentActive)
            if (!stillValid) {
                const stored = getStoredChannelId(serverId)
                const storedValid = !!stored && chs.some((c) => c.id === stored && c.channel_type === 'text')
                const target = storedValid ? stored : (chs.find((c) => c.channel_type === 'text')?.id ?? chs[0]?.id ?? null)
                setActiveChannel(target)
            }
        }).catch(console.error)

        serverApi.get(serverId, token).then((detail) => {
            setMembers(detail.members)
            setMembersForServer(serverId, detail.members)
            setMyServerPermissions((prev) => ({ ...prev, [detail.id]: detail.my_permissions ?? 0 }))
        }).catch(console.error)
    }, [activeServerId, isLoggedIn, token, setActiveChannel, setChannels, setMembers, setChannelsForServer, setMembersForServer])

    useEffect(() => {
        if (activeServerId && activeChannelId) {
            const currentChannel = channels.find((c) => c.id === activeChannelId)
            if (currentChannel && currentChannel.server_id === activeServerId && currentChannel.channel_type === 'text') {
                setStoredChannelId(activeServerId, activeChannelId)
            }
        }
    }, [activeServerId, activeChannelId, channels])

    useEffect(() => {
        if (!activeChannelId || !isLoggedIn) return
        setChannelSearch('')
        setChannelSearchResults(null)
        setHasMoreOlder(true)
        const cached = messagesByChannelRef.current[activeChannelId]
        setMessages(cached ?? [])
        messageApi.list(activeChannelId, token, undefined, MESSAGE_PAGE_SIZE).then((rows) => {
            const ui = rows.map((m) => ({ ...m, clientStatus: undefined, clientId: undefined, clientError: undefined }))
            messagesByChannelRef.current[activeChannelId] = ui
            setMessages(ui)
            if (rows.length < MESSAGE_PAGE_SIZE) setHasMoreOlder(false)
        }).catch(console.error)
    }, [activeChannelId, isLoggedIn, token])

    useEffect(() => {
        if (!activeChannelId || !isLoggedIn) return
        const q = channelSearch.trim()
        if (!q) {
            setChannelSearchResults(null)
            return
        }
        const id = window.setTimeout(() => {
            messageApi.search(activeChannelId, q, token)
                .then((rows) => setChannelSearchResults(rows))
                .catch(() => setChannelSearchResults([]))
        }, 220)
        return () => window.clearTimeout(id)
    }, [activeChannelId, channelSearch, token, isLoggedIn])

    useEffect(() => {
        if (!activeChannelId || !isLoggedIn) return
        messageApi.listPins(activeChannelId, token).then(setChannelPins).catch(() => setChannelPins([]))
    }, [activeChannelId, token, isLoggedIn])

    const refreshChannelPins = useCallback(() => {
        if (!activeChannelId) return
        messageApi.listPins(activeChannelId, token).then(setChannelPins).catch(() => setChannelPins([]))
    }, [activeChannelId, token])

    const handlePinChannelMessage = useCallback(async (messageId: string) => {
        if (!activeChannelId || !isLoggedIn) return
        try {
            await messageApi.pinMessage(activeChannelId, messageId, token)
            refreshChannelPins()
        } catch (e) {
            pushToast({ level: 'error', title: 'Pin failed', message: e instanceof Error ? e.message : 'Failed to pin' })
        }
    }, [activeChannelId, token, isLoggedIn, refreshChannelPins, pushToast])

    const handleUnpinChannelMessage = useCallback(async (messageId: string) => {
        if (!activeChannelId || !isLoggedIn) return
        try {
            await messageApi.unpinMessage(activeChannelId, messageId, token)
            refreshChannelPins()
        } catch (e) {
            pushToast({ level: 'error', title: 'Unpin failed', message: e instanceof Error ? e.message : 'Failed to unpin' })
        }
    }, [activeChannelId, token, isLoggedIn, refreshChannelPins, pushToast])

    const loadOlderMessages = useCallback(async () => {
        if (!activeChannelId || !isLoggedIn || loadingOlder || !hasMoreOlder) return
        const current = messagesByChannelRef.current[activeChannelId] ?? []
        const oldestId = current[0]?.id
        if (!oldestId) return
        setLoadingOlder(true)
        try {
            const rows = await messageApi.list(activeChannelId, token, oldestId, MESSAGE_PAGE_SIZE)
            const ui = rows.map((m) => ({ ...m, clientStatus: undefined, clientId: undefined, clientError: undefined }))
            const merged = [...ui, ...current]
            messagesByChannelRef.current[activeChannelId] = merged
            setMessages(merged)
            if (rows.length < MESSAGE_PAGE_SIZE) setHasMoreOlder(false)
            const scrollEl = messagesScrollRef.current
            if (scrollEl && rows.length > 0) {
                const estimateRowHeight = 64
                requestAnimationFrame(() => {
                    scrollEl.scrollTop += rows.length * estimateRowHeight
                })
            }
        } catch (e) {
            console.error('Load older messages failed', e)
        } finally {
            setLoadingOlder(false)
        }
    }, [activeChannelId, isLoggedIn, token, loadingOlder, hasMoreOlder])

    useEffect(() => {
        if (!activeChannelId) return
        setUnreadByChannel((prev) => {
            if (!prev[activeChannelId]) return prev
            const next = { ...prev }
            delete next[activeChannelId]
            return next
        })
    }, [activeChannelId])

    useEffect(() => {
        if (!activeChannelId) return
        const draft = sessionStorage.getItem('voxpery-draft-mention')
        if (!draft) return
        setMessageInput((prev) => (prev.trim() ? prev : draft))
        sessionStorage.removeItem('voxpery-draft-mention')
    }, [activeChannelId])

    // ─── WebSocket ─────────────────────────────

    // Handle incoming messages
    const handleWsEvent = useCallback((data: unknown) => {
        try {
            const ev = data as { type?: string; data?: Record<string, unknown> }
            if (!ev || typeof ev.type !== 'string') return
            const d = ev.data ?? {}
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
                        setChannels(chs)
                        setChannelCategories(categories.map((c) => c.name))
                        const currentActive = activeChannelIdRef.current
                        const stillValid = !!currentActive && chs.some((c) => c.id === currentActive)
                        if (!stillValid) {
                            const target = chs.find((c) => c.channel_type === 'text')?.id ?? chs[0]?.id ?? null
                            store.setActiveChannel(target)
                        }
                    })
                    .catch(() => { })
            }
            switch (ev.type) {
                case 'NewMessage': {
                    const incomingChannelId = d.channel_id as string | undefined
                    const rawMsg = d.message
                    if (!incomingChannelId || !rawMsg) break
                    const incoming = rawMsg as MessageWithAuthor
                    if (incomingChannelId === activeChannelIdRef.current) {
                        setMessages((prev) => {
                            if (prev.some((m) => m.id === incoming.id)) return prev
                            const withoutMatchingOptimistic = prev.filter((m) => !(
                                m.clientStatus === 'sending' &&
                                m.author?.user_id === incoming.author?.user_id &&
                                m.content === incoming.content
                            ))
                            const next = [...withoutMatchingOptimistic, incoming]
                            messagesByChannelRef.current[incomingChannelId] = next
                            return next
                        })
                    } else {
                        const cached = messagesByChannelRef.current[incomingChannelId]
                        if (cached?.length && !cached.some((m) => m.id === incoming.id)) {
                            messagesByChannelRef.current[incomingChannelId] = [...cached, incoming]
                        }
                        if (incoming.author?.user_id !== user?.id) {
                            // Server-side notifications are intentionally disabled.
                        }
                    }
                    break
                }
                case 'MessageDeleted': {
                    const channelId = d.channel_id as string | undefined
                    const messageId = d.message_id as string | undefined
                    if (!channelId || !messageId) break
                    setMessages((prev) => prev.filter((m) => m.id !== messageId))
                    const cached = messagesByChannelRef.current[channelId]
                    if (cached) {
                        messagesByChannelRef.current[channelId] = cached.filter((m) => m.id !== messageId)
                    }
                    break
                }
                case 'MessageUpdated': {
                    const channelId = d.channel_id as string | undefined
                    const message = d.message as MessageWithAuthor | undefined
                    if (!channelId || !message?.id) break
                    setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)))
                    const cached = messagesByChannelRef.current[channelId]
                    if (cached) {
                        messagesByChannelRef.current[channelId] = cached.map((m) => (m.id === message.id ? message : m))
                    }
                    break
                }
                case 'PresenceUpdate': {
                    const user_id = d.user_id as string | undefined
                    const status = d.status as string | undefined
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
                case 'MemberJoined': {
                    const eventSid = d.server_id as string | undefined
                    if (!eventSid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(eventSid, t, false)
                    break
                }
                case 'MemberRoleUpdated': {
                    const sid = d.server_id as string | undefined
                    if (!sid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(sid, t, true)
                    break
                }
                case 'ServerRolesUpdated': {
                    const sid = d.server_id as string | undefined
                    if (!sid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(sid, t, true)
                    break
                }
                case 'ServerChannelsUpdated': {
                    const sid = d.server_id as string | undefined
                    if (!sid) break
                    const t = tokenRef.current ?? null
                    refreshServerSnapshot(sid, t, true)
                    break
                }
                case 'MemberLeft': {
                    const leftUserId = d.user_id as string | undefined
                    const sid = d.server_id as string | undefined
                    if (!leftUserId || !sid) break
                    const store = useAppStore.getState()
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
                    const channel_id = d.channel_id as string | null | undefined
                    const user_id = d.user_id as string | undefined
                    const server_id = d.server_id as string | null | undefined
                    if (!user_id) break
                    const store = useAppStore.getState()
                    store.setVoiceState(user_id, channel_id ?? null)
                    store.setVoiceStateServerId(user_id, server_id ?? null)
                    break
                }
                case 'VoiceControlUpdate': {
                    const user_id = d.user_id as string | undefined
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
            }
        } catch (err) {
            console.error('AppLayout WS handler error:', err)
        }
    }, [setChannels, user?.id])

    // Subscribe to WebSocket events (connection is managed globally by AppShell)
    useEffect(() => {
        if (!isLoggedIn) return

        const unsubscribe = subscribe(handleWsEvent)

        return () => {
            unsubscribe()
        }
    }, [isLoggedIn, token, connect, subscribe, handleWsEvent])

    // Subscribe to all active-server channels to keep unread badges in sync.
    useEffect(() => {
        if (!isConnected || channels.length === 0) return
        const channelIds = channels.map((c) => c.id)
        send('Subscribe', { channel_ids: channelIds })
        return () => {
            send('Unsubscribe', { channel_ids: channelIds })
        }
    }, [channels, isConnected, send])

    // ─── Handlers ──────────────────────────────

    const handleSendMessage = async (e?: FormEvent) => {
        e?.preventDefault()
        if (!canSendMessages) return
        if ((!messageInput.trim() && draftAttachments.length === 0) || !activeChannelId || !isLoggedIn) return
        const bodyText = messageInput.trim()
        const content = replyingTo
            ? `> @${replyingTo.username}: ${replyingTo.contentSnippet}\n\n${bodyText}`
            : bodyText
        setReplyingTo(null)
        const attachments = draftAttachments
        const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const optimisticId = `local-${clientId}`
        const optimistic: UiMessage = {
            id: optimisticId,
            channel_id: activeChannelId,
            content,
            attachments,
            created_at: new Date().toISOString(),
            edited_at: null,
            author: {
                user_id: user?.id ?? 'local',
                username: user?.username ?? 'You',
                avatar_url: user?.avatar_url,
            },
            clientId,
            clientStatus: 'sending',
        }
        setMessageInput('')
        setDraftAttachments([])
        setMessages((prev) => {
            const next = [...prev, optimistic]
            messagesByChannelRef.current[activeChannelId] = next
            return next
        })
        try {
            const msg = await messageApi.send(activeChannelId, content, attachments, token)
            setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev
                const idx = prev.findIndex((m) => m.clientId === clientId)
                if (idx < 0) {
                    const next = [...prev, msg]
                    messagesByChannelRef.current[activeChannelId] = next
                    return next
                }
                const next = [...prev]
                next[idx] = msg
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
        } catch (err) {
            console.error('Failed to send:', err)
            setMessages((prev) => {
                const next = prev.map((m) =>
                    m.clientId === clientId
                        ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Send failed' }
                        : m
                ) as UiMessage[]
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
        }
    }

    const handleRetryMessage = async (clientId: string) => {
        if (!canSendMessages) return
        if (!activeChannelId || !isLoggedIn) return
        const target = messages.find((m) => m.clientId === clientId)
        if (!target || target.clientStatus !== 'failed') return
        setMessages((prev) => {
            const next = prev.map((m) => (
                m.clientId === clientId ? { ...m, clientStatus: 'sending' as const, clientError: undefined } : m
            )) as UiMessage[]
            messagesByChannelRef.current[activeChannelId] = next
            return next
        })
        try {
            const msg = await messageApi.send(activeChannelId, target.content, target.attachments ?? [], token)
            setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) {
                    const next = prev.filter((m) => m.clientId !== clientId)
                    messagesByChannelRef.current[activeChannelId] = next
                    return next
                }
                const next = prev.map((m) => (m.clientId === clientId ? msg : m))
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
        } catch (err) {
            setMessages((prev) => {
                const next = prev.map((m) =>
                    m.clientId === clientId
                        ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Retry failed' }
                        : m
                ) as UiMessage[]
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
        }
    }

    const handleToggleChannelReaction = async (
        messageId: string,
        emoji: string,
        reacted: boolean,
    ) => {
        if (!activeChannelId || !isLoggedIn || !canSendMessages) return
        try {
            const updated = reacted
                ? await messageApi.removeReaction(messageId, emoji, token)
                : await messageApi.addReaction(messageId, emoji, token)
            setMessages((prev) => {
                const next = prev.map((m) => (m.id === updated.id ? { ...updated } : m))
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Reaction failed',
                message: err instanceof Error ? err.message : 'Could not update reaction.',
            })
        }
    }

    const handleDeleteMessage = async (messageId: string) => {
        if (!activeChannelId || !isLoggedIn) return
        const isLocalOptimistic = messageId.startsWith('local-')
        if (isLocalOptimistic) {
            setMessages((prev) => {
                const next = prev.filter((m) => m.id !== messageId)
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
            setDeleteMessageConfirmId(null)
            return
        }
        try {
            await messageApi.delete(messageId, token)
            setMessages((prev) => {
                const next = prev.filter((m) => m.id !== messageId)
                messagesByChannelRef.current[activeChannelId] = next
                return next
            })
            setDeleteMessageConfirmId(null)
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Delete failed',
                message: err instanceof Error ? err.message : 'Could not delete message',
            })
            setDeleteMessageConfirmId(null)
        }
    }

    const handleReplyToMessage = useCallback((msg: { id: string; author?: { username?: string }; content: string }) => {
        const username = msg.author?.username ?? 'User'
        const snippet = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content
        setReplyingTo({ id: msg.id, username, contentSnippet: snippet })
    }, [])

    const handleSaveEdit = useCallback(async () => {
        if (!editingMessageId || !isLoggedIn) return
        const body = editingContent.trim()
        if (!body && !editingReplyQuotePart) return
        const contentToSend = editingReplyQuotePart ? `${editingReplyQuotePart}\n\n${body}` : body
        try {
            const updated = await messageApi.edit(editingMessageId, contentToSend, token)
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
            if (activeChannelId) messagesByChannelRef.current[activeChannelId] = (messagesByChannelRef.current[activeChannelId] ?? []).map((m) => (m.id === updated.id ? updated : m))
            setEditingMessageId(null)
            setEditingContent('')
            setEditingReplyQuotePart(null)
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Edit failed',
                message: err instanceof Error ? err.message : 'Could not edit message',
            })
        }
    }, [editingMessageId, editingContent, editingReplyQuotePart, token, activeChannelId, pushToast, isLoggedIn])

    const handleCancelEdit = useCallback(() => {
        setEditingMessageId(null)
        setEditingContent('')
        setEditingReplyQuotePart(null)
    }, [])

    const handleForwardMessage = useCallback(async (msg: { author?: { username?: string }; content: string }, targetChannelId: string) => {
        if (!isLoggedIn) return
        const from = msg.author?.username ?? 'Someone'
        const content = `[Forwarded from @${from}]: ${msg.content}`
        try {
            const sent = await messageApi.send(targetChannelId, content, [], token)
            setMessages((prev) => {
                if (targetChannelId !== activeChannelId) return prev
                if (prev.some((m) => m.id === sent.id)) return prev
                const next = [...prev, sent]
                messagesByChannelRef.current[targetChannelId] = next
                return next
            })
            if (targetChannelId !== activeChannelId && messagesByChannelRef.current[targetChannelId]) {
                messagesByChannelRef.current[targetChannelId] = [...(messagesByChannelRef.current[targetChannelId] ?? []), sent]
            }
            if (targetChannelId !== activeChannelId) {
                setActiveChannel(targetChannelId)
            }
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Forward failed',
                message: err instanceof Error ? err.message : 'Could not forward message',
            })
        }
    }, [isLoggedIn, token, activeChannelId, setActiveChannel, pushToast])

    const handleForwardToFriend = useCallback(async (msg: { author?: { username?: string }; content: string }, friendId: string) => {
        if (!isLoggedIn) return
        const from = msg.author?.username ?? 'Someone'
        const content = `[Forwarded from @${from}]: ${msg.content}`
        try {
            const dmChannel = await dmApi.getOrCreateChannel(friendId, token)
            if (!dmChannels.some((c) => c.id === dmChannel.id)) {
                setDmChannels([dmChannel, ...dmChannels])
                setDmChannelIds([dmChannel.id, ...dmChannels.map((c) => c.id)])
            }
            setActiveDmChannelId(dmChannel.id)
            navigate('/')
            await dmApi.sendMessage(dmChannel.id, content, [], token)
        } catch (err) {
            pushToast({
                level: 'error',
                title: 'Forward failed',
                message: err instanceof Error ? err.message : 'Could not forward to friend',
            })
        }
    }, [token, dmChannels, setDmChannels, setDmChannelIds, setActiveDmChannelId, navigate, pushToast, isLoggedIn])

    const handleAttachmentPick = async (files: FileList | null) => {
        if (!files) return
        const list = Array.from(files).slice(0, 4)
        const next: Array<{ name: string; url: string; size: number; type: string }> = []
        const oversized: string[] = []
        for (const f of list) {
            if (f.size > MAX_ATTACHMENT_BYTES) {
                oversized.push(f.name)
                continue
            }
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result))
                reader.onerror = () => reject(reader.error)
                reader.readAsDataURL(f)
            })
            next.push({ name: f.name, size: f.size, type: f.type, url: dataUrl })
        }
        if (oversized.length > 0) {
            const maxMb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))
            pushToast({
                level: 'error',
                title: 'Upload blocked',
                message: `Maximum ${maxMb} MB per file. Too large: ${oversized.join(', ')}`,
            })
        }
        setDraftAttachments((prev) => [...prev, ...next].slice(0, 4))
    }

    const handleCreateServer = async (e: FormEvent) => {
        e.preventDefault()
        setCreateServerError(null)
        if (!newServerName.trim() || !isLoggedIn) return
        try {
            const server = await serverApi.create(newServerName, token)
            const allServers = await serverApi.list(token)
            setServers(allServers)
            setActiveServer(server.id)
            setNewServerName('')
            setShowCreateServer(false)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create server.'
            setCreateServerError(message)
        }
    }

    const handleJoinServer = async (e: FormEvent) => {
        e.preventDefault()
        setJoinServerError(null)
        if (!inviteCode.trim() || !isLoggedIn) return
        try {
            const server = await serverApi.join(inviteCode, token)
            const allServers = await serverApi.list(token)
            setServers(allServers)
            setActiveServer(server.id)
            setInviteCode('')
            setShowJoinServer(false)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to join server.'
            setJoinServerError(message)
        }
    }

    const openCreateModal = () => {
        setCreateServerError(null)
        setShowCreateServer(true)
    }
    const openJoinModal = () => {
        setJoinServerError(null)
        setShowJoinServer(true)
    }
    const openServerSettingsModal = (serverId?: string | null) => {
        setServerSettingsError(null)
        setDeleteServerError(null)
        setDeleteServerInput('')
        setShowDeleteServerConfirm(false)
        setServerSettingsTab('overview')
        setServerSettingsServerId(serverId ?? activeServerId ?? null)
        setShowServerSettings(true)
    }
    const openServerSettingsForServer = (serverId: string) => {
        if (activeServerId !== serverId) setActiveServer(serverId)
        openServerSettingsModal(serverId)
    }

    const activeServer = servers.find((s) => s.id === activeServerId)
    const [myServerPermissions, setMyServerPermissions] = useState<Record<string, number>>({})
    const activePerms = activeServerId ? myServerPermissions[activeServerId] ?? 0 : 0
    const activeChannelForPerms = activeChannelId ? channels.find((c) => c.id === activeChannelId) : null
    const activeChannelPerms =
        activeChannelForPerms != null
            ? (activeChannelForPerms.my_permissions ?? 0)
            : activePerms
    // Permissions-based gating (backend enforces same).
    const canManageChannels = (activePerms & PERM_MANAGE_CHANNELS) === PERM_MANAGE_CHANNELS
    const canSendMessages = (activeChannelPerms & PERM_SEND_MESSAGES) === PERM_SEND_MESSAGES
    const canManageMessages = (activeChannelPerms & PERM_MANAGE_MESSAGES) === PERM_MANAGE_MESSAGES
    const canManagePins = (activeChannelPerms & PERM_MANAGE_PINS) === PERM_MANAGE_PINS
    const canMuteMembers = (activePerms & PERM_MUTE_MEMBERS) === PERM_MUTE_MEMBERS
    const canDeafenMembers = (activePerms & PERM_DEAFEN_MEMBERS) === PERM_DEAFEN_MEMBERS
    const canBanMembers = (activePerms & PERM_BAN_MEMBERS) === PERM_BAN_MEMBERS
    const canManageBans = canBanMembers
    const canViewAuditLog = (activePerms & PERM_VIEW_AUDIT_LOG) === PERM_VIEW_AUDIT_LOG
    const settingsServer = servers.find((s) => s.id === serverSettingsServerId) ?? activeServer
    const settingsServerId = settingsServer?.id ?? null
    const isOwner = !!(settingsServer && user && settingsServer.owner_id === user.id)
    const trimmedServerSettingsName = serverSettingsName.trim()
    const hasNameChanges = !!(
        isOwner &&
        settingsServer &&
        trimmedServerSettingsName.length > 0 &&
        trimmedServerSettingsName !== settingsServer.name
    )
    const effectiveServerIcon = serverSettingsIconDraft !== undefined
        ? serverSettingsIconDraft
        : (settingsServer?.icon_url ?? null)
    const hasIconChanges = !!(
        isOwner &&
        settingsServer &&
        serverSettingsIconDraft !== undefined &&
        serverSettingsIconDraft !== (settingsServer.icon_url ?? null)
    )
    const canSaveServerSettings = hasNameChanges || hasIconChanges

    useEffect(() => {
        setServerSettingsName(settingsServer?.name ?? '')
        setServerSettingsIconDraft(undefined)
    }, [settingsServer?.id, settingsServer?.name])

    // Load roles when Roles tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'roles') return
        if (!isLoggedIn || !settingsServerId) return
        const load = async () => {
            setRolesLoading(true)
            setRolesError(null)
            try {
                const roles = await serverApi.listRoles(settingsServerId, token)
                setServerRoles(roles)
                if (roles.length === 0) {
                    // No roles yet: keep editor blank until user creates one.
                    setSelectedRoleId(null)
                    setRoleEditName('')
                    setRoleEditPermissions(0)
                } else if (selectedRoleIdRef.current) {
                    // If a specific role (or "new") was already selected, try to keep that state.
                    const existing = roles.find((r) => r.id === selectedRoleIdRef.current)
                    if (existing) {
                        setSelectedRoleId(existing.id)
                        setRoleEditName(existing.name)
                        setRoleEditPermissions(existing.permissions)
                    }
                } else {
                    // User hasn't selected anything yet: do not auto-select a role.
                    setRoleEditName('')
                    setRoleEditPermissions(0)
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load roles.'
                setRolesError(message)
            } finally {
                setRolesLoading(false)
            }
        }
        void load()
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServerId, token])

    // Load audit log when Audit tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'audit') return
        if (!isLoggedIn || !settingsServerId) return
        const load = async () => {
            setAuditLogLoading(true)
            setAuditLogError(null)
            try {
                const entries = await serverApi.auditLog(settingsServerId, token)
                setAuditLogEntries(entries)
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : 'Failed to load audit log.'
                setAuditLogError(message)
            } finally {
                setAuditLogLoading(false)
            }
        }
        void load()
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServerId, token])

    // Load bans when Bans tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'bans') return
        if (!isLoggedIn || !settingsServerId) return
        const load = async () => {
            setBanEntriesLoading(true)
            setBanEntriesError(null)
            try {
                const entries = await serverApi.listBans(settingsServerId, token)
                setBanEntries(entries)
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load banned members.'
                setBanEntriesError(message)
            } finally {
                setBanEntriesLoading(false)
            }
        }
        void load()
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServerId, token])

    // When leaving Roles tab or closing Server Settings, drop any unsaved role edits.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'roles') {
            setSelectedRoleId(null)
            setRoleEditName('')
            setRoleEditPermissions(0)
            setRoleEditPreAdminPermissions(null)
            setRolesError(null)
        }
    }, [showServerSettings, serverSettingsTab])

    useEffect(() => {
        setVisibleRoleCount(40)
    }, [serverSettingsServerId, serverRoles])

    const handleCreateRoleDraft = () => {
        setRolesError(null)
        setSelectedRoleId('new')
        setRoleEditName('')
        setRoleEditPermissions(0)
        setRoleEditPreAdminPermissions(null)
        setRoleEditColor(null)
    }

    const handleSelectRole = (role: ServerRole) => {
        if (selectedRoleId === role.id) {
            // Toggle off: collapse editor for this role.
            setSelectedRoleId(null)
            setRoleEditName('')
            setRoleEditPermissions(0)
            setRoleEditPreAdminPermissions(null)
            return
        }
        setSelectedRoleId(role.id)
        setRoleEditName(role.name)
        setRoleEditPermissions(role.permissions)
        setRoleEditPreAdminPermissions(null)
        setRoleEditColor(role.color)
    }

    const handleDropRole = async (targetRoleId: string) => {
        if (!draggingRoleId || !settingsServer) return
        if (draggingRoleId === targetRoleId) return
        const fromIndex = serverRoles.findIndex((r) => r.id === draggingRoleId)
        const toIndex = serverRoles.findIndex((r) => r.id === targetRoleId)
        if (fromIndex === -1 || toIndex === -1) return

        const next = [...serverRoles]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        setServerRoles(next)
        setDraggingRoleId(null)
        try {
            await serverApi.reorderRoles(
                settingsServer.id,
                next.map((r) => r.id),
                token,
            )
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : 'Failed to reorder roles.'
            setRolesError(message)
        }
    }

    const handleToggleRolePermission = (bit: number, isFullAdmin: boolean, checked: boolean) => {
        const ADMIN_MASK =
            PERM_VIEW_SERVER |
            PERM_MANAGE_SERVER |
            PERM_MANAGE_ROLES |
            PERM_MANAGE_CHANNELS |
            PERM_KICK_MEMBERS |
            PERM_BAN_MEMBERS |
            PERM_VIEW_AUDIT_LOG |
            PERM_SEND_MESSAGES |
            PERM_MANAGE_MESSAGES |
            PERM_MANAGE_PINS |
            PERM_CONNECT_VOICE |
            PERM_MUTE_MEMBERS |
            PERM_DEAFEN_MEMBERS

        if (isFullAdmin) {
            if (checked) {
                // Snapshot current custom set once, so unchecking Full admin can restore it.
                if ((roleEditPermissions & PERM_MANAGE_SERVER) !== PERM_MANAGE_SERVER) {
                    setRoleEditPreAdminPermissions(roleEditPermissions)
                }
                setRoleEditPermissions(roleEditPermissions | ADMIN_MASK)
            } else {
                const restored =
                    roleEditPreAdminPermissions != null
                        ? roleEditPreAdminPermissions
                        : (roleEditPermissions & ~ADMIN_MASK)
                setRoleEditPermissions(restored)
                setRoleEditPreAdminPermissions(null)
            }
            return
        }

        const next = checked ? roleEditPermissions | bit : roleEditPermissions & ~bit
        setRoleEditPermissions(next)
    }

    const handleCancelRoleEdit = () => {
        setSelectedRoleId(null)
        setRoleEditName('')
        setRoleEditPermissions(0)
        setRoleEditPreAdminPermissions(null)
        setRoleEditColor(null)
    }

    const handleSaveRole = async () => {
        if (!settingsServer) return
        try {
            const existing = selectedRoleId
                ? serverRoles.find((r) => r.id === selectedRoleId)
                : undefined
            if (!existing) {
                await serverApi.createRole(
                    settingsServer.id,
                    roleEditName.trim(),
                    roleEditPermissions,
                    token,
                    roleEditColor,
                )
            } else {
                await serverApi.updateRole(
                    settingsServer.id,
                    existing.id,
                    {
                        name: roleEditName.trim(),
                        permissions: roleEditPermissions,
                        color: roleEditColor,
                    },
                    token,
                )
            }
            const roles = await serverApi.listRoles(
                settingsServer.id,
                token,
            )
            setServerRoles(roles)
            handleCancelRoleEdit()
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : 'Failed to save role.'
            setRolesError(message)
        }
    }

    const handleServerSettingsProfileRender = useCallback(
        (
            id: string,
            phase: 'mount' | 'update' | 'nested-update',
            actualDuration: number,
            baseDuration: number,
            startTime: number,
            commitTime: number,
        ) => {
            const store = ((window as unknown as { __voxperyProfile?: Array<Record<string, unknown>> }).__voxperyProfile ??= [])
            store.push({
                id,
                phase,
                actualDuration,
                baseDuration,
                startTime,
                commitTime,
                at: Date.now(),
            })
            if (store.length > 400) {
                store.splice(0, store.length - 400)
            }
        },
        []
    )

    const refreshServerList = useCallback(async () => {
        if (!isLoggedIn) return []
        const allServers = await serverApi.list(token)
        setServers(allServers)
        return allServers
    }, [setServers, isLoggedIn, token])

    const handleUpdateServerSettings = async () => {
        if (!isLoggedIn || !settingsServer) return
        if (!canSaveServerSettings) return
        setServerSettingsError(null)
        try {
            const payload: { name?: string; icon_url?: string; clear_icon?: boolean } = {}
            if (hasNameChanges) payload.name = trimmedServerSettingsName
            if (hasIconChanges) {
                if (serverSettingsIconDraft == null) payload.clear_icon = true
                else payload.icon_url = serverSettingsIconDraft
            }
            await serverApi.update(settingsServer.id, payload, token)
            await refreshServerList()
            setServerSettingsIconDraft(undefined)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to update server settings.'
            setServerSettingsError(message)
        }
    }

    const actuallyCloseServerSettings = useCallback(() => {
        setShowServerSettings(false)
        setServerSettingsError(null)
        setServerSettingsServerId(null)
        setCopiedInvite(null)
        setServerSettingsName(settingsServer?.name ?? '')
        setServerSettingsIconDraft(undefined)
        setShowDeleteServerConfirm(false)
        setDeleteServerError(null)
        setDeleteServerInput('')
    }, [settingsServer?.name])

    const handleCloseServerSettings = useCallback(() => {
        if (canSaveServerSettings) {
            setShowUnsavedServerSettingsConfirm(true)
            return
        }
        actuallyCloseServerSettings()
    }, [canSaveServerSettings, actuallyCloseServerSettings])

    const handleServerIconPick = async (files: FileList | null) => {
        if (!files || files.length === 0 || !settingsServer) return
        const file = files[0]
        if (!file.type.startsWith('image/')) {
            pushToast({
                level: 'error',
                title: 'Invalid file type',
                message: 'Only image files are supported for server icon uploads.',
            })
            return
        }
        if (file.size > MAX_IMAGE_BYTES) {
            const maxMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024))
            pushToast({
                level: 'error',
                title: 'Image too large',
                message: `Server icon must be ${maxMb} MB or smaller.`,
            })
            return
        }
        const iconDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
        })
        setServerSettingsIconDraft(iconDataUrl)
        setServerSettingsError(null)
    }

    const handleClearServerIcon = () => {
        if (!settingsServer) return
        setServerSettingsIconDraft(null)
        setServerSettingsError(null)
    }

    const handleDeleteServer = useCallback(async () => {
        if (!isLoggedIn || !settingsServer) return
        setServerSettingsError(null)
        setDeleteServerError(null)
        if (deleteServerInput.trim() !== settingsServer.name) {
            setDeleteServerError('Server name does not match.')
            return
        }
        try {
            await serverApi.delete(settingsServer.id, token)
            const allServers = await refreshServerList()
            const next = allServers.find((s) => s.invite_code === 'voxpery' || s.name === 'Voxpery')?.id ?? allServers[0]?.id ?? null
            setActiveServer(next)
            setShowServerSettings(false)
            setServerSettingsServerId(null)
            setShowDeleteServerConfirm(false)
            setDeleteServerInput('')
            setDeleteServerError(null)
            setCopiedInvite(null)
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to delete server.'
            setDeleteServerError(message)
        }
    }, [deleteServerInput, refreshServerList, setActiveServer, token, settingsServer, isLoggedIn])

    useEffect(() => {
        if (!showServerSettings) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (
                    channelSettingsTarget
                    || categoryPermissionsTarget
                    || showUnsavedServerSettingsConfirm
                    || deleteRoleConfirmId
                    || showDeleteServerConfirm
                    || showRenameCategory
                    || deleteCategoryConfirm
                    || showRenameChannel
                    || deleteChannelConfirm
                    || deleteMessageConfirmId
                ) {
                    return
                }
                e.preventDefault()
                handleCloseServerSettings()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [
        showServerSettings,
        handleCloseServerSettings,
        channelSettingsTarget,
        categoryPermissionsTarget,
        showUnsavedServerSettingsConfirm,
        deleteRoleConfirmId,
        showDeleteServerConfirm,
        showRenameCategory,
        deleteCategoryConfirm,
        showRenameChannel,
        deleteChannelConfirm,
        deleteMessageConfirmId,
    ])

    useEffect(() => {
        if (
            !showCreateChannel
            && !showCreateCategory
            && !showCreateServer
            && !showJoinServer
            && !showRenameChannel
            && !showRenameCategory
            && !showDeleteServerConfirm
            && !showUnsavedServerSettingsConfirm
            && !deleteRoleConfirmId
            && !deleteMessageConfirmId
            && !deleteChannelConfirm
            && !deleteCategoryConfirm
            && !channelSettingsTarget
            && !categoryPermissionsTarget
        ) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            if (deleteCategoryConfirm) {
                setDeleteCategoryConfirm(null)
                setDeleteCategoryError(null)
                return
            }
            if (deleteChannelConfirm) {
                setDeleteChannelConfirm(null)
                return
            }
            if (deleteMessageConfirmId) {
                setDeleteMessageConfirmId(null)
                return
            }
            if (deleteRoleConfirmId) {
                setDeleteRoleConfirmId(null)
                return
            }
            if (showUnsavedServerSettingsConfirm) {
                setShowUnsavedServerSettingsConfirm(false)
                return
            }
            if (showDeleteServerConfirm) {
                setShowDeleteServerConfirm(false)
                setDeleteServerError(null)
                return
            }
            if (showRenameCategory) {
                setShowRenameCategory(false)
                setRenameCategoryError(null)
                setRenameCategoryFrom(null)
                return
            }
            if (showRenameChannel) {
                setShowRenameChannel(false)
                setRenameChannelError(null)
                setRenameChannelId(null)
                return
            }
            if (categoryPermissionsTarget) {
                setCategoryPermissionsTarget(null)
                return
            }
            if (channelSettingsTarget) {
                setChannelSettingsTarget(null)
                return
            }
            if (showCreateChannel) {
                setShowCreateChannel(false)
                setCreateChannelError(null)
                setCreateChannelCategory('')
                return
            }
            if (showCreateCategory) {
                setShowCreateCategory(false)
                setCreateCategoryError(null)
                return
            }
            if (showJoinServer) {
                setShowJoinServer(false)
                setJoinServerError(null)
                return
            }
            if (showCreateServer) {
                setShowCreateServer(false)
                setCreateServerError(null)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [
        showCreateChannel,
        showCreateCategory,
        showCreateServer,
        showJoinServer,
        showRenameChannel,
        showRenameCategory,
        showDeleteServerConfirm,
        showUnsavedServerSettingsConfirm,
        deleteRoleConfirmId,
        deleteMessageConfirmId,
        deleteChannelConfirm,
        deleteCategoryConfirm,
        channelSettingsTarget,
        categoryPermissionsTarget,
        setShowCreateServer,
        setShowJoinServer,
    ])

    const activeChannel = channels.find((c) => c.id === activeChannelId)
    const channelCategorySuggestions = useMemo(
        () =>
            Array.from(
                new Set(
                    [...channelCategories, ...channels.map((c) => c.category ?? '')]
                        .map((c) => c.trim())
                        .filter((c): c is string => !!c),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        [channels, channelCategories],
    )

    const handleCreateChannel = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !activeServerId || !createChannelName.trim()) return
        const validationError = validateChannelNameInput(createChannelName)
        if (validationError) {
            setCreateChannelError(validationError)
            return
        }
        const normalizedCategory = createChannelCategory.trim() || 'GENERAL'
        const categoryValidation = validateCategoryNameInput(normalizedCategory)
        if (categoryValidation) {
            setCreateChannelError(categoryValidation)
            return
        }
        setCreateChannelError(null)
        try {
            await channelApi.create(
                activeServerId,
                createChannelName.trim(),
                createChannelType,
                token,
                normalizedCategory,
            )
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            const categories = await channelApi.listCategories(activeServerId, token)
            setChannelCategories(categories.map((c) => c.name))
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setShowCreateChannel(false)
            setCreateChannelName('')
            setCreateChannelType('text')
            setCreateChannelCategory('')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create channel.'
            setCreateChannelError(message)
        }
    }

    const openCreateChannelModal = () => {
        setCreateChannelError(null)
        setCreateChannelName('')
        setCreateChannelType('text')
        setCreateChannelCategory('')
        setShowCreateChannel(true)
    }

    const openCreateCategoryModal = () => {
        setCreateCategoryError(null)
        setCreateCategoryName('')
        setShowCreateCategory(true)
    }

    const handleCreateCategory = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !activeServerId || !createCategoryName.trim()) return
        const validationError = validateCategoryNameInput(createCategoryName)
        if (validationError) {
            setCreateCategoryError(validationError)
            return
        }
        setCreateCategoryError(null)
        try {
            await channelApi.createCategory(activeServerId, createCategoryName.trim(), token)
            const categories = await channelApi.listCategories(activeServerId, token)
            setChannelCategories(categories.map((c) => c.name))
            setShowCreateCategory(false)
            setCreateCategoryName('')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create category.'
            setCreateCategoryError(message)
        }
    }

    const openRenameCategoryModal = (category: string) => {
        setRenameCategoryError(null)
        setRenameCategoryFrom(category)
        setRenameCategoryName(category)
        setShowRenameCategory(true)
    }

    const handleRenameCategory = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !activeServerId || !renameCategoryFrom || !renameCategoryName.trim()) return
        const nextName = renameCategoryName.trim()
        const validationError = validateCategoryNameInput(nextName)
        if (validationError) {
            setRenameCategoryError(validationError)
            return
        }
        setRenameCategoryError(null)
        try {
            await channelApi.renameCategory(activeServerId, renameCategoryFrom, nextName, token)
            const [chs, categories] = await Promise.all([
                serverApi.channels(activeServerId, token),
                channelApi.listCategories(activeServerId, token),
            ])
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            setChannelCategories(categories.map((c) => c.name))
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setShowRenameCategory(false)
            setRenameCategoryFrom(null)
            setRenameCategoryName('')
        } catch (err: unknown) {
            setRenameCategoryError(err instanceof Error ? err.message : 'Failed to rename category.')
        }
    }

    const resolveDeleteCategoryMoveTarget = useCallback(
        (categoryName: string): string => {
            const normalized = categoryName.trim().toLowerCase()
            const preferredGeneral = channelCategories.find(
                (name) => name.trim().toLowerCase() === 'general',
            )

            if (preferredGeneral && preferredGeneral.trim().toLowerCase() !== normalized) {
                return preferredGeneral
            }

            const firstOther = channelCategories.find(
                (name) => name.trim().toLowerCase() !== normalized,
            )
            if (firstOther) return firstOther

            return 'General'
        },
        [channelCategories],
    )

    const openRenameChannelModal = (channel: Channel) => {
        setRenameChannelError(null)
        setRenameChannelId(channel.id)
        setRenameChannelName(channel.name)
        setShowRenameChannel(true)
    }

    const handleRenameChannel = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !renameChannelId || !renameChannelName.trim()) return
        const validationError = validateChannelNameInput(renameChannelName)
        if (validationError) {
            setRenameChannelError(validationError)
            return
        }
        setRenameChannelError(null)
        try {
            await channelApi.rename(renameChannelId, renameChannelName.trim(), token)
            if (!activeServerId) return
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setShowRenameChannel(false)
            setRenameChannelId(null)
            setRenameChannelName('')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to rename channel.'
            setRenameChannelError(message)
        }
    }

    const handleDeleteChannel = async (channel: Channel) => {
        if (!isLoggedIn || !activeServerId) return
        const previousChannels = channels
        const newChs = previousChannels.filter((c) => c.id !== channel.id)
        setChannels(newChs)
        setChannelsForServer(activeServerId, newChs)
        setChannelServerMap((prev) => {
            const next = { ...prev }
            delete next[channel.id]
            return next
        })
        if (activeChannelId === channel.id) {
            const nextText = newChs.find((c) => c.channel_type === 'text')
            setActiveChannel(nextText?.id ?? newChs[0]?.id ?? null)
        }
        try {
            await channelApi.delete(channel.id, token)
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            const categories = await channelApi.listCategories(activeServerId, token)
            setChannelCategories(categories.map((c) => c.name))
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
        } catch (err) {
            setChannels(previousChannels)
            setChannelsForServer(activeServerId, previousChannels)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of previousChannels) next[ch.id] = ch.server_id
                return next
            })
            if (activeChannelId === channel.id) setActiveChannel(channel.id)
            pushToast({
                level: 'error',
                title: 'Failed to delete channel',
                message: err instanceof Error ? err.message : 'Could not delete channel',
            })
        } finally {
            setDeleteChannelConfirm(null)
        }
    }

    const orderedChannelIds = (source: Channel[]) =>
        [...source]
            .sort(compareChannelsForSidebar)
            .map((c) => c.id)

    const handleReorderChannels = async (
        draggedChannelId: string,
        targetChannelId: string,
        position: 'before' | 'after',
    ) => {
        if (!isLoggedIn || !activeServerId) return
        const dragged = channels.find((c) => c.id === draggedChannelId)
        const target = channels.find((c) => c.id === targetChannelId)
        if (!dragged || !target) return
        if (dragged.channel_type !== target.channel_type) return

        const previous = [...channels]
        const targetCategory = target.category ?? 'Channels'
        const shouldMoveCategory = (dragged.category ?? 'Channels') !== targetCategory

        const ordered = [...channels].sort(compareChannelsForSidebar)
        const withoutDragged = ordered.filter((c) => c.id !== draggedChannelId)
        const targetIndex = withoutDragged.findIndex((c) => c.id === targetChannelId)
        if (targetIndex < 0) return

        const moved = ordered.find((c) => c.id === draggedChannelId)
        if (!moved) return

        const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
        withoutDragged.splice(insertIndex, 0, {
            ...moved,
            category: shouldMoveCategory ? targetCategory : moved.category,
        })

        const positionByCategory = new Map<string, number>()
        const nextChannels = withoutDragged.map((channel) => {
            const category = channel.category ?? 'Channels'
            const nextPosition = positionByCategory.get(category) ?? 0
            positionByCategory.set(category, nextPosition + 1)
            if (channel.position === nextPosition) return channel
            return { ...channel, position: nextPosition }
        })

        setChannels(nextChannels)
        setChannelsForServer(activeServerId, nextChannels)
        try {
            if (shouldMoveCategory) {
                await channelApi.rename(
                    dragged.id,
                    dragged.name,
                    token,
                    targetCategory,
                )
            }
            await channelApi.reorder(activeServerId, orderedChannelIds(nextChannels), token)
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
        } catch (err) {
            console.error('Failed to reorder channels:', err)
            setChannels(previous)
            setChannelsForServer(activeServerId, previous)
        }
    }

    const handleMoveChannelToCategory = async (
        draggedChannelId: string,
        targetCategory: string,
        placement: 'start' | 'end' = 'end',
    ) => {
        if (!isLoggedIn || !activeServerId) return
        const dragged = channels.find((c) => c.id === draggedChannelId)
        if (!dragged) return
        const currentCategory = dragged.category ?? 'Channels'
        if (currentCategory === targetCategory) return

        const previous = [...channels]
        const movedBase = channels.map((ch) =>
            ch.id === draggedChannelId
                ? {
                    ...ch,
                    category: targetCategory,
                    position: placement === 'start' ? -1 : Number.MAX_SAFE_INTEGER,
                }
                : ch,
        )
        const sortedByCategory = [...movedBase].sort(compareChannelsForSidebar)
        const positionByCategory = new Map<string, number>()
        const nextChannels = sortedByCategory.map((ch) => {
            const cat = ch.category ?? 'Channels'
            const nextPos = positionByCategory.get(cat) ?? 0
            positionByCategory.set(cat, nextPos + 1)
            if (ch.position === nextPos) return ch
            return { ...ch, position: nextPos }
        })

        setChannels(nextChannels)
        setChannelsForServer(activeServerId, nextChannels)
        try {
            await channelApi.rename(dragged.id, dragged.name, token, targetCategory)
            await channelApi.reorder(activeServerId, orderedChannelIds(nextChannels), token)
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
        } catch (err) {
            console.error('Failed to move channel to category:', err)
            setChannels(previous)
            setChannelsForServer(activeServerId, previous)
        }
    }

    const handleReorderCategories = async (
        draggedCategory: string,
        targetCategory: string,
        position: 'before' | 'after',
    ) => {
        if (!isLoggedIn || !activeServerId) return
        if (draggedCategory === targetCategory) return
        const derivedFromChannels = Array.from(
            new Set(
                channels
                    .map((c) => c.category?.trim())
                    .filter((c): c is string => !!c),
            ),
        )
        const baseCategories = Array.from(new Set([...channelCategories, ...derivedFromChannels]))
        const next = baseCategories.filter((c) => c !== draggedCategory)
        const targetIndex = next.findIndex((c) => c === targetCategory)
        if (targetIndex < 0) return
        const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
        next.splice(insertIndex, 0, draggedCategory)
        setChannelCategories(next)
        try {
            await channelApi.reorderCategories(activeServerId, next, token)
        } catch (err) {
            console.error('Failed to reorder categories:', err)
            const categories = await channelApi.listCategories(activeServerId, token).catch(() => [])
            setChannelCategories(categories.map((c) => c.name))
        }
    }

    // ─── Render ────────────────────────────────

    return (
        <div className="app-layout">
            {!skipServerSidebar && (
                <ServerSidebar
                    onCreateServer={openCreateModal}
                    onJoinServer={openJoinModal}
                    onOpenServerSettings={openServerSettingsForServer}
                />
            )}
            <ChannelSidebar
                onOpenServerSettings={openServerSettingsModal}
                onOpenCreateChannel={openCreateChannelModal}
                onOpenCreateCategory={openCreateCategoryModal}
                onOpenCategoryPermissions={(category) => setCategoryPermissionsTarget(category)}
                onRenameCategory={openRenameCategoryModal}
                onDeleteCategory={(category) => {
                    setDeleteCategoryError(null)
                    setDeleteCategoryConfirm(category)
                }}
                onReorderCategories={handleReorderCategories}
                onMoveChannelToCategory={handleMoveChannelToCategory}
                channelCategories={channelCategories}
                canManageChannels={canManageChannels}
                canMuteMembers={canMuteMembers}
                canDeafenMembers={canDeafenMembers}
                unreadByChannel={unreadByChannel}
                voiceControls={voiceControls}
                onRenameChannel={openRenameChannelModal}
                onDeleteChannel={(channel) => setDeleteChannelConfirm(channel)}
                onReorderChannels={handleReorderChannels}
            />
            <ChatArea
                activeChannel={activeChannel}
                messages={channelSearch.trim() ? (channelSearchResults ?? []) : messages}
                draftAttachments={draftAttachments}
                messageInput={messageInput}
                onPickAttachments={handleAttachmentPick}
                onRemoveAttachment={(index) => setDraftAttachments((prev) => prev.filter((_, i) => i !== index))}
                onMessageInputChange={setMessageInput}
                onSendMessage={handleSendMessage}
                onRetryMessage={handleRetryMessage}
                onDeleteMessage={(messageId) => setDeleteMessageConfirmId(messageId)}
                onReplyToMessage={handleReplyToMessage}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
                onForwardMessage={handleForwardMessage}
                onForwardToFriend={handleForwardToFriend}
                channelsForForward={channels}
                friendsForForward={friends}
                editingMessageId={editingMessageId}
                editingContent={editingContent}
                onEditMessage={(msg) => {
                    setEditingMessageId(msg.id)
                    setEditingContent(msg.contentToEdit ?? msg.content)
                    setEditingReplyQuotePart(msg.replyQuotePart ?? null)
                }}
                onEditingContentChange={setEditingContent}
                onSaveEdit={handleSaveEdit}
                onCancelEdit={handleCancelEdit}
                currentUserId={user?.id ?? null}
                canModerate={canManageMessages}
                mentionUsers={members.map((member) => ({
                    user_id: member.user_id,
                    username: member.username,
                    avatar_url: member.avatar_url,
                }))}
                isViewActive={isViewActive}
                hasMoreOlder={!channelSearch.trim() && hasMoreOlder}
                loadingOlder={loadingOlder}
                onLoadOlder={loadOlderMessages}
                onScrollRefReady={(ref) => { messagesScrollRef.current = ref }}
                searchQuery={channelSearch}
                onSearchChange={setChannelSearch}
                pinnedMessages={channelPins}
                onPinMessage={canManagePins ? handlePinChannelMessage : undefined}
                onUnpinMessage={canManagePins ? handleUnpinChannelMessage : undefined}
                onToggleReaction={canSendMessages ? handleToggleChannelReaction : undefined}
                canSendMessages={canSendMessages}
            />
            <MemberSidebar
                canKickMembers={(activePerms & PERM_KICK_MEMBERS) === PERM_KICK_MEMBERS}
                canBanMembers={canBanMembers}
                canManageRolesFromPerms={(activePerms & PERM_MANAGE_ROLES) === PERM_MANAGE_ROLES}
            />

            {createPortal(
                <>
                    {/* Create Server Modal */}
                    {showCreateServer && (
                        <div className="modal-overlay" onClick={() => { setShowCreateServer(false); setCreateServerError(null); }}>
                            <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateServer}>
                                <h2>Create a Server</h2>
                                {createServerError && (
                                    <div className="auth-error" style={{ marginBottom: 16 }}>{createServerError}</div>
                                )}
                                <div className="form-group">
                                    <label>Server Name</label>
                                    <input
                                        type="text"
                                        value={newServerName}
                                        onChange={(e) => setNewServerName(e.target.value)}
                                        placeholder="My Awesome Server"
                                        autoFocus
                                        required
                                    />
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateServer(false); setCreateServerError(null); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Create</button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Join Server Modal */}
                    {showJoinServer && (
                        <div className="modal-overlay" onClick={() => { setShowJoinServer(false); setJoinServerError(null); }}>
                            <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleJoinServer}>
                                <h2>Join a Server</h2>
                                {joinServerError && (
                                    <div className="auth-error" style={{ marginBottom: 16 }}>{joinServerError}</div>
                                )}
                                <div className="form-group">
                                    <label>Invite Code</label>
                                    <input
                                        type="text"
                                        value={inviteCode}
                                        onChange={(e) => setInviteCode(e.target.value)}
                                        placeholder="abc12345"
                                        autoFocus
                                        required
                                    />
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowJoinServer(false); setJoinServerError(null); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Join</button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Create Channel Modal */}
                    {showCreateChannel && activeServerId && (
                        <div className="modal-overlay" onClick={() => { setShowCreateChannel(false); setCreateChannelError(null); setCreateChannelCategory('') }}>
                            <form className="modal modal-create-channel" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateChannel}>
                                <h2>Create Channel</h2>
                                {createChannelError && (
                                    <div className="auth-error" style={{ marginBottom: 16 }}>{createChannelError}</div>
                                )}
                                <div className="form-group">
                                    <label>Channel name</label>
                                    <input
                                        type="text"
                                        value={createChannelName}
                                        onChange={(e) => setCreateChannelName(e.target.value)}
                                        placeholder="e.g. general"
                                        autoFocus
                                        required
                                        maxLength={CHANNEL_NAME_MAX}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Channel type</label>
                                    <div className="channel-type-selector">
                                        <button
                                            type="button"
                                            className={`channel-type-option ${createChannelType === 'text' ? 'channel-type-option--selected' : ''}`}
                                            onClick={() => setCreateChannelType('text')}
                                        >
                                            <MessageSquare size={24} strokeWidth={1.8} />
                                            <span className="channel-type-option__label">Text</span>
                                            <span className="channel-type-option__desc">Chat and share files</span>
                                        </button>
                                        <button
                                            type="button"
                                            className={`channel-type-option ${createChannelType === 'voice' ? 'channel-type-option--selected' : ''}`}
                                            onClick={() => setCreateChannelType('voice')}
                                        >
                                            <Mic size={24} strokeWidth={1.8} />
                                            <span className="channel-type-option__label">Voice</span>
                                            <span className="channel-type-option__desc">Talk with voice</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Category (optional, default: GENERAL)</label>
                                    <input
                                        type="text"
                                        value={createChannelCategory}
                                        onChange={(e) => setCreateChannelCategory(e.target.value)}
                                        placeholder="GENERAL"
                                        list="channel-category-suggestions"
                                        maxLength={CATEGORY_NAME_MAX}
                                    />
                                    <datalist id="channel-category-suggestions">
                                        {channelCategorySuggestions.map((category) => (
                                            <option key={category} value={category} />
                                        ))}
                                    </datalist>
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateChannel(false); setCreateChannelError(null); setCreateChannelCategory('') }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Create Channel</button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Create Category Modal */}
                    {showCreateCategory && activeServerId && (
                        <div className="modal-overlay" onClick={() => { setShowCreateCategory(false); setCreateCategoryError(null) }}>
                            <form className="modal modal-create-channel" onClick={(e) => e.stopPropagation()} onSubmit={handleCreateCategory}>
                                <h2>Create Category</h2>
                                {createCategoryError && (
                                    <div className="auth-error" style={{ marginBottom: 16 }}>{createCategoryError}</div>
                                )}
                                <div className="form-group">
                                    <label>Category name</label>
                                    <input
                                        type="text"
                                        value={createCategoryName}
                                        onChange={(e) => setCreateCategoryName(e.target.value)}
                                        placeholder="e.g. Squad 1"
                                        autoFocus
                                        required
                                        maxLength={CATEGORY_NAME_MAX}
                                    />
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateCategory(false); setCreateCategoryError(null); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Create Category</button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Rename Channel Modal */}
                    {showRenameChannel && (
                        <div className="modal-overlay" onClick={() => { setShowRenameChannel(false); setRenameChannelError(null); setRenameChannelId(null) }}>
                            <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleRenameChannel}>
                                <h2>Rename Channel</h2>
                                {renameChannelError && (
                                    <div className="auth-error" style={{ marginBottom: 16 }}>{renameChannelError}</div>
                                )}
                                <div className="form-group">
                                    <label>Channel Name</label>
                                    <input
                                        type="text"
                                        value={renameChannelName}
                                        onChange={(e) => setRenameChannelName(e.target.value)}
                                        placeholder="new-channel-name"
                                        autoFocus
                                        required
                                        maxLength={CHANNEL_NAME_MAX}
                                    />
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowRenameChannel(false); setRenameChannelError(null); setRenameChannelId(null) }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Save</button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Server Settings Modal */}
                    {showServerSettings && settingsServer && (
                        <div
                            className="modal-overlay"
                            onClick={handleCloseServerSettings}
                        >
                            <div className="modal modal-server-settings" onClick={(e) => e.stopPropagation()}>
                                <div className="server-settings-header">
                                    <div className="server-settings-header__left">
                                        {effectiveServerIcon ? (
                                            <img src={effectiveServerIcon} alt="" className="server-settings-header__icon" />
                                        ) : (
                                            <div className="server-settings-header__icon server-settings-header__icon--placeholder">
                                                {settingsServer.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div className="server-settings-header__text">
                                            <h2>Server Settings</h2>
                                            <p className="server-settings-header__server-name">{settingsServer.name}</p>
                                            <p className="server-settings-header__hint">Manage overview, roles, invites, and security.</p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="server-settings-close-btn"
                                        onClick={handleCloseServerSettings}
                                        aria-label="Close"
                                    >
                                        ×
                                    </button>
                                </div>

                                <div className="server-settings-body server-settings-body--with-tabs">
                                    {serverSettingsError && (
                                        <div className="auth-error server-settings-error">{serverSettingsError}</div>
                                    )}

                                    <div className="server-settings-layout">
                                        <nav className="server-settings-nav">
                                            <button
                                                type="button"
                                                className={`server-settings-nav__item ${
                                                    serverSettingsTab === 'overview' ? 'server-settings-nav__item--active' : ''
                                                }`}
                                                onClick={() => setServerSettingsTab('overview')}
                                            >
                                                Overview
                                            </button>
                                            {isOwner && (
                                                <button
                                                    type="button"
                                                    className={`server-settings-nav__item ${
                                                        serverSettingsTab === 'roles' ? 'server-settings-nav__item--active' : ''
                                                    }`}
                                                    onClick={() => setServerSettingsTab('roles')}
                                                >
                                                    Roles
                                                </button>
                                            )}
                                            {canViewAuditLog && (
                                                <button
                                                    type="button"
                                                    className={`server-settings-nav__item ${
                                                        serverSettingsTab === 'audit'
                                                            ? 'server-settings-nav__item--active'
                                                            : ''
                                                    }`}
                                                    onClick={() => setServerSettingsTab('audit')}
                                                >
                                                    Audit Log
                                                </button>
                                            )}
                                            {(isOwner || canManageBans) && (
                                                <button
                                                    type="button"
                                                    className={`server-settings-nav__item ${
                                                        serverSettingsTab === 'bans' ? 'server-settings-nav__item--active' : ''
                                                    }`}
                                                    onClick={() => setServerSettingsTab('bans')}
                                                >
                                                    Bans
                                                </button>
                                            )}
                                            {isOwner && (
                                                <button
                                                    type="button"
                                                    className={`server-settings-nav__item ${
                                                        serverSettingsTab === 'danger' ? 'server-settings-nav__item--active' : ''
                                                    }`}
                                                    onClick={() => setServerSettingsTab('danger')}
                                                >
                                                    Danger Zone
                                                </button>
                                            )}
                                        </nav>

                                        <Profiler id="ServerSettings" onRender={handleServerSettingsProfileRender}>
                                        <div className="server-settings-content">
                                            {serverSettingsTab === 'overview' && (
                                                <section className="server-settings-card">
                                                    <h3 className="server-settings-card__title">Overview</h3>
                                                    <div className="server-settings-overview-grid">
                                                        <div className="server-settings-subcard">
                                                            <h4 className="server-settings-subcard__title">Server</h4>
                                                            <div className="form-group">
                                                                <label>Server name</label>
                                                                <input
                                                                    type="text"
                                                                    value={serverSettingsName}
                                                                    onChange={(e) => setServerSettingsName(e.target.value)}
                                                                    placeholder="Server name"
                                                                    disabled={!isOwner}
                                                                />
                                                            </div>
                                                            <div className="form-group">
                                                                <label>Server icon</label>
                                                                <div className="server-settings-icon-row">
                                                                    {effectiveServerIcon ? (
                                                                        <img
                                                                            src={effectiveServerIcon}
                                                                            alt={settingsServer.name}
                                                                            className="server-settings-icon-preview"
                                                                        />
                                                                    ) : (
                                                                        <div className="server-settings-icon-placeholder">
                                                                            {settingsServer.name.charAt(0).toUpperCase()}
                                                                        </div>
                                                                    )}
                                                                    {isOwner && (
                                                                        <div className="server-settings-icon-actions">
                                                                            <button
                                                                                type="button"
                                                                                className="btn btn-secondary btn-sm"
                                                                                onClick={() => serverIconInputRef.current?.click()}
                                                                            >
                                                                                Upload
                                                                            </button>
                                                                            {(effectiveServerIcon ?? null) && (
                                                                                <button
                                                                                    type="button"
                                                                                    className="btn btn-secondary btn-sm"
                                                                                    onClick={handleClearServerIcon}
                                                                                >
                                                                                    Remove
                                                                                </button>
                                                                            )}
                                                                            <input
                                                                                ref={serverIconInputRef}
                                                                                type="file"
                                                                                accept="image/*"
                                                                                style={{ display: 'none' }}
                                                                                onChange={(e) => {
                                                                                    void handleServerIconPick(e.target.files)
                                                                                    e.currentTarget.value = ''
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {isOwner && (
                                                                <div className="server-settings-server-actions">
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-primary btn-sm"
                                                                        disabled={!canSaveServerSettings}
                                                                        onClick={() => void handleUpdateServerSettings()}
                                                                    >
                                                                        Save changes
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="server-settings-subcard">
                                                            <h4 className="server-settings-subcard__title">Invite People</h4>
                                                            <div className="invite-unified-box">
                                                                <div className="invite-unified-row invite-unified-link">
                                                                    <code>
                                                                        {typeof window !== 'undefined'
                                                                            ? `${window.location.origin}/invite/${settingsServer.invite_code}`
                                                                            : `/invite/${settingsServer.invite_code}`}
                                                                    </code>
                                                                </div>
                                                                <div className="invite-unified-actions">
                                                                    <button
                                                                        type="button"
                                                                        className="copy-btn"
                                                                        onClick={() => {
                                                                            const link =
                                                                                typeof window !== 'undefined'
                                                                                    ? `${window.location.origin}/invite/${settingsServer.invite_code}`
                                                                                    : `/invite/${settingsServer.invite_code}`
                                                                            navigator.clipboard.writeText(link).then(() => {
                                                                                setCopiedInvite('link')
                                                                                setTimeout(() => setCopiedInvite(null), 2000)
                                                                            })
                                                                        }}
                                                                    >
                                                                        {copiedInvite === 'link' ? 'Copied' : 'Copy link'}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="copy-btn"
                                                                        onClick={() => {
                                                                            navigator.clipboard.writeText(settingsServer.invite_code).then(() => {
                                                                                setCopiedInvite('code')
                                                                                setTimeout(() => setCopiedInvite(null), 2000)
                                                                            })
                                                                        }}
                                                                    >
                                                                        {copiedInvite === 'code' ? 'Copied' : 'Copy code'}
                                                                    </button>
                                                                </div>
                                                                <p className="invite-unified-hint">
                                                                    Share the link so others can join with one click.
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </section>
                                            )}

                                            {serverSettingsTab === 'danger' && isOwner && (
                                                <section className="server-settings-card server-settings-card--danger">
                                                    <h3 className="server-settings-card__title server-settings-card__title--danger">
                                                        Danger Zone
                                                    </h3>
                                                    <p className="server-settings-danger-text">
                                                        Deleting this server will permanently remove all channels and messages. This
                                                        cannot be undone.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        className="btn btn-danger-outline"
                                                        onClick={() => {
                                                            setDeleteServerError(null)
                                                            setDeleteServerInput('')
                                                            setShowDeleteServerConfirm(true)
                                                        }}
                                                    >
                                                        Delete server
                                                    </button>
                                                </section>
                                            )}

                                            {serverSettingsTab === 'audit' && canViewAuditLog && (
                                                <section className="server-settings-card server-settings-card--audit">
                                                    <h3 className="server-settings-card__title">Audit Log</h3>
                                                    {auditLogError && (
                                                        <div className="auth-error" style={{ marginBottom: 12 }}>
                                                            {auditLogError}
                                                        </div>
                                                    )}
                                                    {auditLogLoading && (
                                                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                            Loading audit log…
                                                        </div>
                                                    )}
                                                    {!auditLogLoading && auditLogEntries && auditLogEntries.length === 0 && (
                                                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                            No audit entries yet.
                                                        </div>
                                                    )}
                                                    {!auditLogLoading && auditLogEntries && auditLogEntries.length > 0 && (
                                                        <ServerSettingsAuditLog
                                                            key={auditLogEntries[0]?.id ?? 'empty-audit'}
                                                            entries={auditLogEntries}
                                                            memberUsernameById={memberUsernameById}
                                                        />
                                                    )}
                                                </section>
                                            )}

                                            {serverSettingsTab === 'bans' && (isOwner || canManageBans) && (
                                                <section className="server-settings-card server-settings-card--audit">
                                                    <h3 className="server-settings-card__title">Banned Users</h3>
                                                    {banEntriesError && (
                                                        <div className="auth-error" style={{ marginBottom: 12 }}>
                                                            {banEntriesError}
                                                        </div>
                                                    )}
                                                    {banEntriesLoading && (
                                                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                            Loading banned users...
                                                        </div>
                                                    )}
                                                    {!banEntriesLoading && banEntries && banEntries.length === 0 && (
                                                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                                                            No banned users.
                                                        </div>
                                                    )}
                                                    {!banEntriesLoading && banEntries && banEntries.length > 0 && (
                                                        <div className="server-settings-ban-list">
                                                            {banEntries.map((entry) => (
                                                                <div key={entry.user_id} className="server-settings-ban-row">
                                                                    <div className="server-settings-ban-meta">
                                                                        <strong>{entry.username}</strong>
                                                                        <span>
                                                                            Banned by {entry.banned_by_username} on {new Date(entry.created_at).toLocaleString()}
                                                                        </span>
                                                                        {entry.reason && (
                                                                            <span className="server-settings-ban-reason">Reason: {entry.reason}</span>
                                                                        )}
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-secondary btn-sm"
                                                                        disabled={unbanInFlightUserId === entry.user_id}
                                                                        onClick={async () => {
                                                                            if (!settingsServerId) return
                                                                            setUnbanInFlightUserId(entry.user_id)
                                                                            setBanEntriesError(null)
                                                                            try {
                                                                                await serverApi.unbanMember(settingsServerId, entry.user_id, token)
                                                                                const refreshed = await serverApi.listBans(settingsServerId, token)
                                                                                setBanEntries(refreshed)
                                                                            } catch (err) {
                                                                                const message =
                                                                                    err instanceof Error
                                                                                        ? err.message
                                                                                        : 'Failed to unban member.'
                                                                                setBanEntriesError(message)
                                                                            } finally {
                                                                                setUnbanInFlightUserId(null)
                                                                            }
                                                                        }}
                                                                    >
                                                                        {unbanInFlightUserId === entry.user_id ? 'Unbanning...' : 'Unban'}
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </section>
                                            )}

                                            {serverSettingsTab === 'roles' && isOwner && (
                                                <section className="server-settings-card">
                                                    <h3 className="server-settings-card__title">Roles</h3>
                                                    <p
                                                        style={{
                                                            margin: '0 0 10px',
                                                            color: 'var(--text-secondary)',
                                                            fontSize: 12,
                                                        }}
                                                    >
                                                        Server owner is system-managed and always has full access.
                                                    </p>
                                                    {rolesError && (
                                                        <div className="auth-error" style={{ marginBottom: 12 }}>
                                                            {rolesError}
                                                        </div>
                                                    )}
                                                    <div className="server-roles-layout">
                                                        <ServerRolesSidebar
                                                            rolesLoading={rolesLoading}
                                                            selectedRoleId={selectedRoleId}
                                                            serverRoles={serverRoles}
                                                            visibleServerRoles={visibleServerRoles}
                                                            hasMoreServerRoles={hasMoreServerRoles}
                                                            onCreateRole={handleCreateRoleDraft}
                                                            onRoleDragStart={setDraggingRoleId}
                                                            onRoleDrop={handleDropRole}
                                                            onRoleSelect={handleSelectRole}
                                                            onLoadMoreRoles={() => setVisibleRoleCount((prev) => prev + 40)}
                                                        />
                                                        <div className="server-roles-detail">
                                                            <ServerRoleEditor
                                                                selectedRoleId={selectedRoleId}
                                                                roleEditName={roleEditName}
                                                                roleEditColor={roleEditColor}
                                                                roleEditPermissions={roleEditPermissions}
                                                                canDeleteRole={!!selectedRoleId && !!serverRoles.find((r) => r.id === selectedRoleId)}
                                                                canSaveRole={!!roleEditName.trim() && !rolesLoading && !!settingsServer}
                                                                bits={{
                                                                    manageServer: PERM_MANAGE_SERVER,
                                                                    manageRoles: PERM_MANAGE_ROLES,
                                                                    manageChannels: PERM_MANAGE_CHANNELS,
                                                                    viewAuditLog: PERM_VIEW_AUDIT_LOG,
                                                                    manageMessages: PERM_MANAGE_MESSAGES,
                                                                    managePins: PERM_MANAGE_PINS,
                                                                    muteMembers: PERM_MUTE_MEMBERS,
                                                                    deafenMembers: PERM_DEAFEN_MEMBERS,
                                                                    kickMembers: PERM_KICK_MEMBERS,
                                                                    banMembers: PERM_BAN_MEMBERS,
                                                                }}
                                                                onRoleNameChange={setRoleEditName}
                                                                onRoleColorChange={setRoleEditColor}
                                                                onTogglePermission={handleToggleRolePermission}
                                                                onDeleteRole={() => {
                                                                    if (!selectedRoleId) return
                                                                    setDeleteRoleConfirmId(selectedRoleId)
                                                                }}
                                                                onCancel={handleCancelRoleEdit}
                                                                onSave={() => void handleSaveRole()}
                                                            />
                                                        </div>
                                                    </div>
                                                </section>
                                            )}
                                        </div>
                                        </Profiler>
                                    </div>
                                </div>

                                {/* Footer removed; Overview card now owns its own Save button when needed. */}
                            </div>
                        </div>
                    )}
                    {showUnsavedServerSettingsConfirm && (
                        <div className="modal-overlay" onClick={() => setShowUnsavedServerSettingsConfirm(false)}>
                            <div className="modal confirm-modal server-delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
                                <h2>Discard changes?</h2>
                                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                    You have unsaved changes to the server name or icon. If you close now, those changes will be
                                    lost.
                                </p>
                                <div className="modal-actions">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setShowUnsavedServerSettingsConfirm(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        onClick={() => {
                                            setShowUnsavedServerSettingsConfirm(false)
                                            actuallyCloseServerSettings()
                                        }}
                                    >
                                        Discard changes
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {deleteRoleConfirmId && settingsServer && (
                        <div className="modal-overlay" onClick={() => setDeleteRoleConfirmId(null)}>
                            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                                <h2>Delete role</h2>
                                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                    Are you sure you want to delete this role? This cannot be undone.
                                </p>
                                <div className="modal-actions">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => setDeleteRoleConfirmId(null)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        onClick={async () => {
                                            if (!isLoggedIn || !deleteRoleConfirmId) return
                                            setRolesError(null)
                                            try {
                                                await serverApi.deleteRole(settingsServer.id, deleteRoleConfirmId, token)
                                                const roles = await serverApi.listRoles(settingsServer.id, token)
                                                setServerRoles(roles)
                                                const next = roles[0]
                                                setSelectedRoleId(next?.id ?? null)
                                                setRoleEditName(next?.name ?? '')
                                                setRoleEditPermissions(next?.permissions ?? 0)
                                                setRoleEditPreAdminPermissions(null)
                                                setDeleteRoleConfirmId(null)
                                            } catch (err) {
                                                const message =
                                                    err instanceof Error
                                                        ? err.message
                                                        : 'Failed to delete role.'
                                                setRolesError(message)
                                                setDeleteRoleConfirmId(null)
                                            }
                                        }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {deleteMessageConfirmId && (
                        <div className="modal-overlay" onClick={() => setDeleteMessageConfirmId(null)}>
                            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                                <h2>Delete message</h2>
                                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                    Are you sure you want to delete this message?
                                </p>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => setDeleteMessageConfirmId(null)}>
                                        Cancel
                                    </button>
                                    <button type="button" className="btn btn-danger" onClick={() => void handleDeleteMessage(deleteMessageConfirmId)}>
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {deleteChannelConfirm && (
                        <div className="modal-overlay" onClick={() => setDeleteChannelConfirm(null)}>
                            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                                <h2>Delete channel</h2>
                                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                    Are you sure you want to permanently delete <strong>#{deleteChannelConfirm.name}</strong>?
                                </p>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => setDeleteChannelConfirm(null)}>
                                        Cancel
                                    </button>
                                    <button type="button" className="btn btn-danger" onClick={() => void handleDeleteChannel(deleteChannelConfirm)}>
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {showDeleteServerConfirm && settingsServer && (
                        <div className="modal-overlay" onClick={() => { setShowDeleteServerConfirm(false); setDeleteServerError(null) }}>
                            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                                <h2>Delete Server</h2>
                                <p style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
                                    Type <strong>{settingsServer.name}</strong> to confirm permanent deletion.
                                </p>
                                {deleteServerError && (
                                    <div className="auth-error" style={{ marginBottom: 12 }}>{deleteServerError}</div>
                                )}
                                <div className="form-group">
                                    <label>Server Name</label>
                                    <input
                                        type="text"
                                        value={deleteServerInput}
                                        onChange={(e) => setDeleteServerInput(e.target.value)}
                                        placeholder={settingsServer.name}
                                        autoFocus
                                    />
                                </div>
                                <div className="modal-actions">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => { setShowDeleteServerConfirm(false); setDeleteServerError(null) }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        onClick={() => void handleDeleteServer()}
                                    >
                                        Delete Server
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {channelSettingsTarget && (
                        <ChannelSettingsModal
                            channel={channelSettingsTarget}
                            serverRoles={serverRoles}
                            onClose={() => setChannelSettingsTarget(null)}
                            onUpdated={async (updated: Channel) => {
                                setChannels(channels.map(c => c.id === updated.id ? updated : c))
                                if (activeServerId) {
                                    const categories = await channelApi.listCategories(activeServerId, token).catch(() => [])
                                    setChannelCategories(categories.map((c) => c.name))
                                }
                            }}
                            onDeleted={async (id: string) => {
                                setChannels(channels.filter(c => c.id !== id))
                                if (activeServerId) {
                                    const categories = await channelApi.listCategories(activeServerId, token).catch(() => [])
                                    setChannelCategories(categories.map((c) => c.name))
                                }
                            }}
                        />
                    )}

                    {/* Rename Category Modal */}
                    {showRenameCategory && (
                        <div className="modal-overlay" onClick={() => { setShowRenameCategory(false); setRenameCategoryError(null); setRenameCategoryFrom(null) }}>
                            <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleRenameCategory}>
                                <h2>Rename Category</h2>
                                {renameCategoryError && (
                                    <div className="auth-error" style={{ marginBottom: 16 }}>{renameCategoryError}</div>
                                )}
                                <div className="form-group">
                                    <label>Category Name</label>
                                    <input
                                        type="text"
                                        value={renameCategoryName}
                                        onChange={(e) => setRenameCategoryName(e.target.value)}
                                        placeholder="new-category-name"
                                        autoFocus
                                        required
                                        maxLength={CATEGORY_NAME_MAX}
                                    />
                                </div>
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowRenameCategory(false); setRenameCategoryError(null); setRenameCategoryFrom(null) }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Save</button>
                                </div>
                            </form>
                        </div>
                    )}
                    {categoryPermissionsTarget && activeServerId && (
                        <CategoryPermissionsModal
                            serverId={activeServerId}
                            category={categoryPermissionsTarget}
                            serverRoles={serverRoles}
                            onClose={() => setCategoryPermissionsTarget(null)}
                        />
                    )}
                    {deleteCategoryConfirm && activeServerId && (
                        <div className="modal-overlay" onClick={() => setDeleteCategoryConfirm(null)}>
                            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
                                <h2>Delete category</h2>
                                {(() => {
                                    const moveTarget = resolveDeleteCategoryMoveTarget(deleteCategoryConfirm)
                                    const channelsInCategory = channels.filter(
                                        (c) => (c.category ?? 'Channels') === deleteCategoryConfirm,
                                    ).length
                                    return channelsInCategory > 0 ? (
                                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                            Channels in <strong>{deleteCategoryConfirm}</strong> will be moved to <strong>{moveTarget}</strong>.
                                        </p>
                                    ) : (
                                        <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                                            <strong>{deleteCategoryConfirm}</strong> is empty.
                                        </p>
                                    )
                                })()}
                                {deleteCategoryError && (
                                    <div className="auth-error" style={{ marginBottom: 10 }}>{deleteCategoryError}</div>
                                )}
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => setDeleteCategoryConfirm(null)}>
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-danger"
                                        onClick={async () => {
                                            try {
                                                const moveTarget = resolveDeleteCategoryMoveTarget(deleteCategoryConfirm)
                                                await channelApi.deleteCategory(
                                                    activeServerId,
                                                    deleteCategoryConfirm,
                                                    token,
                                                    moveTarget,
                                                )
                                                const [chs, categories] = await Promise.all([
                                                    serverApi.channels(activeServerId, token),
                                                    channelApi.listCategories(activeServerId, token).catch(() => []),
                                                ])
                                                setChannels(chs)
                                                setChannelsForServer(activeServerId, chs)
                                                setChannelCategories(categories.map((c) => c.name))
                                                setDeleteCategoryConfirm(null)
                                                setDeleteCategoryError(null)
                                            } catch (err: unknown) {
                                                setDeleteCategoryError(err instanceof Error ? err.message : 'Failed to delete category.')
                                            }
                                        }}
                                    >
                                        Delete Category
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>,
                document.body
            )}
        </div>
    )
}
