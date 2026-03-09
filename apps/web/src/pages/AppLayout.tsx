import { useEffect, useState, useRef, useCallback, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useSocketStore } from '../stores/socket'
import { serverApi, messageApi, channelApi, dmApi, friendApi, type MessageWithAuthor, type Channel, type ServerRole, type AuditLogEntry } from '../api'
import ServerSidebar from '../components/ServerSidebar'
import ChannelSidebar from '../components/ChannelSidebar'
import ChatArea from '../components/ChatArea'
import MemberSidebar from '../components/MemberSidebar'
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

// Permission bit masks (must stay in sync with backend Permissions flags).
const PERM_MANAGE_SERVER = 1 << 1
const PERM_MANAGE_ROLES = 1 << 2
const PERM_MANAGE_CHANNELS = 1 << 3
const PERM_KICK_MEMBERS = 1 << 4
const PERM_VIEW_AUDIT_LOG = 1 << 6
const PERM_MANAGE_MESSAGES = 1 << 8

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
        voiceControls, joinedVoiceChannelId,
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
            joinedVoiceChannelId: s.joinedVoiceChannelId,
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
    const [serverSettingsTab, setServerSettingsTab] = useState<'overview' | 'roles' | 'audit' | 'invite' | 'danger'>('overview')
    const [serverSettingsName, setServerSettingsName] = useState('')
    const [serverSettingsIconDraft, setServerSettingsIconDraft] = useState<string | null | undefined>(undefined)
    const [serverSettingsError, setServerSettingsError] = useState<string | null>(null)
    const [showDeleteServerConfirm, setShowDeleteServerConfirm] = useState(false)
    const [deleteServerInput, setDeleteServerInput] = useState('')
    const [deleteServerError, setDeleteServerError] = useState<string | null>(null)
    const [showCreateChannel, setShowCreateChannel] = useState(false)
    const [createChannelName, setCreateChannelName] = useState('')
    const [createChannelType, setCreateChannelType] = useState<'text' | 'voice'>('text')
    const [createChannelError, setCreateChannelError] = useState<string | null>(null)
    const [showRenameChannel, setShowRenameChannel] = useState(false)
    const [renameChannelId, setRenameChannelId] = useState<string | null>(null)
    const [renameChannelName, setRenameChannelName] = useState('')
    const [renameChannelError, setRenameChannelError] = useState<string | null>(null)
    const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({})
    const [, setChannelServerMap] = useState<Record<string, string>>({})
    const [deleteMessageConfirmId, setDeleteMessageConfirmId] = useState<string | null>(null)
    const [deleteChannelConfirm, setDeleteChannelConfirm] = useState<Channel | null>(null)
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
    const [rolesLoading, setRolesLoading] = useState(false)
    const [rolesError, setRolesError] = useState<string | null>(null)
    const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
    const [draggingRoleId, setDraggingRoleId] = useState<string | null>(null)
    const [roleEditName, setRoleEditName] = useState('')
    const [roleEditPermissions, setRoleEditPermissions] = useState(0)
    const [deleteRoleConfirmId, setDeleteRoleConfirmId] = useState<string | null>(null)
    const [auditLogEntries, setAuditLogEntries] = useState<AuditLogEntry[] | null>(null)
    const [auditLogLoading, setAuditLogLoading] = useState(false)
    const [auditLogError, setAuditLogError] = useState<string | null>(null)

    // Refs to avoid stale closures in WebSocket handlers
    const activeChannelIdRef = useRef(activeChannelId)
    const activeServerIdRef = useRef(activeServerId)
    const tokenRef = useRef(token)
    const serverIconInputRef = useRef<HTMLInputElement | null>(null)
    const messagesByChannelRef = useRef<Record<string, UiMessage[]>>({})

    useEffect(() => { activeChannelIdRef.current = activeChannelId }, [activeChannelId])
    useEffect(() => { activeServerIdRef.current = activeServerId }, [activeServerId])
    useEffect(() => { tokenRef.current = token }, [token])

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
        serverApi.channels(serverId, token).then((chs) => {
            setChannels(chs)
            setChannelsForServer(serverId, chs)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            const currentActive = activeChannelIdRef.current
            const stillValid = !!currentActive && chs.some((c) => c.id === currentActive)
            if (!stillValid) {
                const inThisServer = joinedVoiceChannelId && chs.some((c) => c.id === joinedVoiceChannelId)
                const target = inThisServer ? joinedVoiceChannelId : (chs.find((c) => c.channel_type === 'text')?.id ?? chs[0]?.id ?? null)
                setActiveChannel(target)
            }
        }).catch(console.error)

        serverApi.get(serverId, token).then((detail) => {
            setMembers(detail.members)
            setMembersForServer(serverId, detail.members)
        }).catch(console.error)
    }, [activeServerId, isLoggedIn, token, setActiveChannel, setChannels, setMembers, setChannelsForServer, setMembersForServer, joinedVoiceChannelId])

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
                    const uid = d.user_id as string | undefined
                    const username = d.username as string | undefined
                    if (!eventSid || !uid || !username) break
                    const t = tokenRef.current ?? null
                    serverApi.get(eventSid, t).then((detail) => {
                        const store = useAppStore.getState()
                        store.setMembersForServer(eventSid, detail.members ?? [])
                        if (activeServerIdRef.current === eventSid) {
                            store.setMembers(detail.members ?? [])
                        }
                    }).catch(console.error)
                    break
                }
                case 'MemberRoleUpdated': {
                    const sid = d.server_id as string | undefined
                    const uid = d.user_id as string | undefined
                    const role = d.role as string | undefined
                    if (!uid || !role || !sid) break

                    const store = useAppStore.getState()
                    const updateList = (list: typeof store.members) => list.map((m) => m.user_id === uid ? { ...m, role } : m)

                    if (activeServerIdRef.current === sid) {
                        store.setMembers(updateList(store.members ?? []))
                    }
                    const cached = store.membersByServerId[sid] ?? []
                    if (cached.length > 0) {
                        store.setMembersForServer(sid, updateList(cached))
                    }
                    // If the updated user is the current user, refetch server detail so their UI (sidebar, buttons) updates immediately
                    const currentUserId = useAuthStore.getState().user?.id
                    if (uid === currentUserId && activeServerIdRef.current === sid && tokenRef.current) {
                        serverApi.get(sid, tokenRef.current).then((detail) => {
                            const s = useAppStore.getState()
                            s.setMembers(detail.members ?? [])
                            s.setMembersForServer(sid, detail.members ?? [])
                        }).catch(() => {})
                    }
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
                    const screen_sharing = d.screen_sharing
                    const camera_on = d.camera_on
                    if (!user_id) break
                    const store = useAppStore.getState()
                    store.setVoiceControl(user_id, !!muted, !!deafened, !!screen_sharing)
                    store.setVoiceCamera(user_id, !!camera_on)
                    break
                }
            }
        } catch (err) {
            console.error('AppLayout WS handler error:', err)
        }
    }, [user?.id])

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
            navigate('/app/social')
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
    const myMember = members.find((m) => m.user_id === user?.id)
    // Owner and moderator can create, rename, delete, reorder channels (backend enforces same).
    const canManageChannels = myMember?.role === 'owner' || myMember?.role === 'moderator'
    const canViewAuditLog = myMember?.role === 'owner' || myMember?.role === 'moderator'
    const settingsServer = servers.find((s) => s.id === serverSettingsServerId) ?? activeServer
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
        if (!isLoggedIn || !settingsServer) return
        const load = async () => {
            setRolesLoading(true)
            setRolesError(null)
            try {
                const roles = await serverApi.listRoles(settingsServer.id, token)
                setServerRoles(roles)
                if (roles.length === 0) {
                    // No roles yet: keep editor blank until user creates one.
                    setSelectedRoleId(null)
                    setRoleEditName('')
                    setRoleEditPermissions(0)
                } else if (selectedRoleId) {
                    // If a specific role (or "new") was already selected, try to keep that state.
                    const existing = roles.find((r) => r.id === selectedRoleId)
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
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServer?.id])

    // Load audit log when Audit tab is opened.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'audit') return
        if (!isLoggedIn || !settingsServer) return
        const load = async () => {
            setAuditLogLoading(true)
            setAuditLogError(null)
            try {
                const entries = await serverApi.auditLog(settingsServer.id, token)
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
    }, [showServerSettings, serverSettingsTab, isLoggedIn, settingsServer?.id, token])

    // When leaving Roles tab or closing Server Settings, drop any unsaved role edits.
    useEffect(() => {
        if (!showServerSettings || serverSettingsTab !== 'roles') {
            setSelectedRoleId(null)
            setRoleEditName('')
            setRoleEditPermissions(0)
            setRolesError(null)
        }
    }, [showServerSettings, serverSettingsTab])

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

    const actuallyCloseServerSettings = () => {
        setShowServerSettings(false)
        setServerSettingsError(null)
        setServerSettingsServerId(null)
        setCopiedInvite(null)
        setServerSettingsName(settingsServer?.name ?? '')
        setServerSettingsIconDraft(undefined)
        setShowDeleteServerConfirm(false)
        setDeleteServerError(null)
        setDeleteServerInput('')
    }

    const handleCloseServerSettings = () => {
        if (canSaveServerSettings) {
            setShowUnsavedServerSettingsConfirm(true)
            return
        }
        actuallyCloseServerSettings()
    }

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
                e.preventDefault()
                handleCloseServerSettings()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [showServerSettings, handleCloseServerSettings])

    const activeChannel = channels.find((c) => c.id === activeChannelId)

    const handleCreateChannel = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !activeServerId || !createChannelName.trim()) return
        setCreateChannelError(null)
        try {
            await channelApi.create(activeServerId, createChannelName.trim(), createChannelType, token)
            const chs = await serverApi.channels(activeServerId, token)
            setChannels(chs)
            setChannelsForServer(activeServerId, chs)
            setChannelServerMap((prev) => {
                const next = { ...prev }
                for (const ch of chs) next[ch.id] = ch.server_id
                return next
            })
            setShowCreateChannel(false)
            setCreateChannelName('')
            setCreateChannelType('text')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create channel.'
            setCreateChannelError(message)
        }
    }

    const openCreateChannelModal = () => {
        setCreateChannelError(null)
        setCreateChannelName('')
        setCreateChannelType('text')
        setShowCreateChannel(true)
    }

    const openRenameChannelModal = (channel: Channel) => {
        setRenameChannelError(null)
        setRenameChannelId(channel.id)
        setRenameChannelName(channel.name)
        setShowRenameChannel(true)
    }

    const handleRenameChannel = async (e: FormEvent) => {
        e.preventDefault()
        if (!isLoggedIn || !renameChannelId || !renameChannelName.trim()) return
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
            .sort((a, b) => {
                const aCat = a.category ?? 'Channels'
                const bCat = b.category ?? 'Channels'
                if (aCat !== bCat) return aCat.localeCompare(bCat)
                return a.position - b.position
            })
            .map((c) => c.id)

    const handleReorderChannels = async (draggedChannelId: string, targetChannelId: string) => {
        if (!isLoggedIn || !activeServerId) return
        const dragged = channels.find((c) => c.id === draggedChannelId)
        const target = channels.find((c) => c.id === targetChannelId)
        if (!dragged || !target) return
        const category = dragged.category ?? 'Channels'
        if ((target.category ?? 'Channels') !== category) return

        const sameCat = channels
            .filter((c) => (c.category ?? 'Channels') === category)
            .sort((a, b) => a.position - b.position)
        const from = sameCat.findIndex((c) => c.id === draggedChannelId)
        const to = sameCat.findIndex((c) => c.id === targetChannelId)
        if (from < 0 || to < 0 || from === to) return

        const reordered = [...sameCat]
        const [moved] = reordered.splice(from, 1)
        reordered.splice(to, 0, moved)
        const positionById = new Map(reordered.map((c, i) => [c.id, i]))
        const nextChannels = channels.map((c) => {
            if ((c.category ?? 'Channels') !== category) return c
            const nextPos = positionById.get(c.id)
            if (nextPos === undefined || c.position === nextPos) return c
            return { ...c, position: nextPos }
        })
        const changed = nextChannels.some((c, idx) => c.position !== channels[idx]?.position)
        if (!changed) return
        setChannels(nextChannels)
        setChannelsForServer(activeServerId, nextChannels)
        try {
            await channelApi.reorder(activeServerId, orderedChannelIds(nextChannels), token)
        } catch (err) {
            console.error('Failed to reorder channels:', err)
            serverApi.channels(activeServerId, token).then((chs) => {
                setChannels(chs)
                setChannelsForServer(activeServerId, chs)
            }).catch(console.error)
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
                canManageChannels={canManageChannels}
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
                canModerate={canManageChannels}
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
                onPinMessage={canManageChannels ? handlePinChannelMessage : undefined}
                onUnpinMessage={canManageChannels ? handleUnpinChannelMessage : undefined}
            />
            <MemberSidebar />

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
                        <div className="modal-overlay" onClick={() => { setShowCreateChannel(false); setCreateChannelError(null); }}>
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
                                <div className="modal-actions">
                                    <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateChannel(false); setCreateChannelError(null); }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary">Create Channel</button>
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
                                                <>
                                                    <button
                                                        type="button"
                                                        className={`server-settings-nav__item ${
                                                            serverSettingsTab === 'roles' ? 'server-settings-nav__item--active' : ''
                                                        }`}
                                                        onClick={() => setServerSettingsTab('roles')}
                                                    >
                                                        Roles
                                                    </button>
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
                                                            Audit log
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className={`server-settings-nav__item ${
                                                            serverSettingsTab === 'invite' ? 'server-settings-nav__item--active' : ''
                                                        }`}
                                                        onClick={() => setServerSettingsTab('invite')}
                                                    >
                                                        Invite
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`server-settings-nav__item ${
                                                            serverSettingsTab === 'danger' ? 'server-settings-nav__item--active' : ''
                                                        }`}
                                                        onClick={() => setServerSettingsTab('danger')}
                                                    >
                                                        Danger zone
                                                    </button>
                                                </>
                                            )}
                                        </nav>

                                        <div className="server-settings-content">
                                            {serverSettingsTab === 'overview' && (
                                                <section className="server-settings-card">
                                                    <h3 className="server-settings-card__title">Overview</h3>
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
                                                                <>
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
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {isOwner && (
                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
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
                                                </section>
                                            )}

                                            {serverSettingsTab === 'invite' && isOwner && (
                                                <section className="server-settings-card">
                                                    <h3 className="server-settings-card__title">Invite people</h3>
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
                                                </section>
                                            )}

                                            {serverSettingsTab === 'danger' && isOwner && (
                                                <section className="server-settings-card server-settings-card--danger">
                                                    <h3 className="server-settings-card__title server-settings-card__title--danger">
                                                        Danger zone
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
                                                <section className="server-settings-card">
                                                    <h3 className="server-settings-card__title">Audit log</h3>
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
                                                        <div
                                                            style={{
                                                                maxHeight: 260,
                                                                overflowY: 'auto',
                                                                fontSize: 12,
                                                            }}
                                                        >
                                                            {auditLogEntries.map((entry) => {
                                                                const actorName = entry.actor_username ?? members.find((m) => m.user_id === entry.actor_id)?.username ?? 'Unknown'
                                                                const targetName = entry.resource_username ?? (entry.resource_id ? members.find((m) => m.user_id === entry.resource_id)?.username : null)
                                                                const actionLine = targetName
                                                                    ? `${actorName} — ${entry.action} → ${targetName}`
                                                                    : `${actorName} — ${entry.action}`
                                                                return (
                                                                    <div
                                                                        key={entry.id}
                                                                        style={{
                                                                            padding: '6px 0',
                                                                            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                                                                        }}
                                                                    >
                                                                        <div
                                                                            style={{
                                                                                display: 'flex',
                                                                                justifyContent: 'space-between',
                                                                                gap: 8,
                                                                            }}
                                                                        >
                                                                            <span style={{ color: 'var(--text-secondary)' }}>
                                                                                {new Date(entry.at).toLocaleString()}
                                                                            </span>
                                                                            <span
                                                                                style={{
                                                                                    color: 'var(--text-muted)',
                                                                                    textTransform: 'uppercase',
                                                                                    letterSpacing: 0.04,
                                                                                }}
                                                                            >
                                                                                {entry.resource_type}
                                                                            </span>
                                                                        </div>
                                                                        <div style={{ color: 'var(--text-primary)' }}>
                                                                            {actionLine}
                                                                        </div>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    )}
                                                </section>
                                            )}

                                            {serverSettingsTab === 'roles' && isOwner && (
                                                <section className="server-settings-card">
                                                    <h3 className="server-settings-card__title">Roles</h3>
                                                    {rolesError && (
                                                        <div className="auth-error" style={{ marginBottom: 12 }}>
                                                            {rolesError}
                                                        </div>
                                                    )}
                                                    <div className="server-roles-layout">
                                                        <div className="server-roles-sidebar">
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    alignItems: 'center',
                                                                    marginBottom: 8,
                                                                }}
                                                            >
                                                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                                    Server roles
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-secondary btn-xs"
                                                                    style={{
                                                                        fontSize: 11,
                                                                        padding: '3px 10px',
                                                                        borderRadius: 9999,
                                                                        border: '1px solid rgba(255, 255, 255, 0.14)',
                                                                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                                                                        cursor: 'pointer',
                                                                    }}
                                                                    disabled={rolesLoading}
                                                                    onClick={() => {
                                                                        setRolesError(null)
                                                                        setSelectedRoleId('new')
                                                                        setRoleEditName('')
                                                                        setRoleEditPermissions(0)
                                                                    }}
                                                                >
                                                                    Create role
                                                                </button>
                                                            </div>
                                                            <div className="server-roles-sidebar-list">
                                                                {rolesLoading && (
                                                                    <div
                                                                        style={{
                                                                            padding: 8,
                                                                            fontSize: 12,
                                                                            color: 'var(--text-muted)',
                                                                        }}
                                                                    >
                                                                        Loading roles…
                                                                    </div>
                                                                )}
                                                                {!rolesLoading &&
                                                                    serverRoles.map((role) => (
                                                                        <button
                                                                            key={role.id}
                                                                            type="button"
                                                                            className={`server-settings-nav__item ${
                                                                                selectedRoleId === role.id
                                                                                    ? 'server-settings-nav__item--active'
                                                                                    : ''
                                                                            }`}
                                                                            style={{
                                                                                borderRadius: 0,
                                                                                width: '100%',
                                                                                textAlign: 'left',
                                                                                cursor: 'grab',
                                                                            }}
                                                                            draggable
                                                                            onDragStart={() => setDraggingRoleId(role.id)}
                                                                            onDragOver={(e) => {
                                                                                e.preventDefault()
                                                                            }}
                                                                            onDrop={async (e) => {
                                                                                e.preventDefault()
                                                                                if (!draggingRoleId || !settingsServer) return
                                                                                if (draggingRoleId === role.id) return
                                                                                const fromIndex = serverRoles.findIndex(
                                                                                    (r) => r.id === draggingRoleId,
                                                                                )
                                                                                const toIndex = serverRoles.findIndex(
                                                                                    (r) => r.id === role.id,
                                                                                )
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
                                                                            }}
                                                                            onClick={() => {
                                                                                if (selectedRoleId === role.id) {
                                                                                    // Toggle off: collapse editor for this role.
                                                                                    setSelectedRoleId(null)
                                                                                    setRoleEditName('')
                                                                                    setRoleEditPermissions(0)
                                                                                } else {
                                                                                    setSelectedRoleId(role.id)
                                                                                    setRoleEditName(role.name)
                                                                                    setRoleEditPermissions(role.permissions)
                                                                                }
                                                                            }}
                                                                        >
                                                                            {role.name}
                                                                        </button>
                                                                    ))}
                                                                {!rolesLoading && serverRoles.length === 0 && (
                                                                    <div
                                                                        style={{
                                                                            padding: 8,
                                                                            fontSize: 12,
                                                                            color: 'var(--text-muted)',
                                                                        }}
                                                                    >
                                                                        No roles yet. Create one to get started.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="server-roles-detail">
                                                            {selectedRoleId ? (
                                                                <>
                                                                    <div
                                                                        style={{
                                                                            marginBottom: 12,
                                                                            maxWidth: 320,
                                                                        }}
                                                                    >
                                                                        <label className="server-settings-card__title" style={{ display: 'block', marginBottom: 6 }}>
                                                                            Role name
                                                                        </label>
                                                                        <input
                                                                            type="text"
                                                                            value={roleEditName}
                                                                            onChange={(e) => setRoleEditName(e.target.value)}
                                                                            maxLength={64}
                                                                            placeholder="Role name"
                                                                            style={{ fontSize: 13, padding: '4px 8px', width: '85%' }}
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <div className="server-settings-card__title" style={{ marginBottom: 6 }}>
                                                                            Permissions
                                                                        </div>
                                                                        <div
                                                                            style={{
                                                                                display: 'grid',
                                                                                gridTemplateColumns: '1fr',
                                                                                gap: 6,
                                                                            }}
                                                                        >
                                                                            {[
                                                                                // Manage group first
                                                                                { label: 'Full admin', bit: PERM_MANAGE_SERVER },
                                                                                { label: 'Manage roles', bit: PERM_MANAGE_ROLES },
                                                                                { label: 'Manage channels', bit: PERM_MANAGE_CHANNELS },
                                                                                { label: 'Manage messages', bit: PERM_MANAGE_MESSAGES },
                                                                                { label: 'Kick members', bit: PERM_KICK_MEMBERS },
                                                                                { label: 'View audit log', bit: PERM_VIEW_AUDIT_LOG },
                                                                            ].map((perm) => {
                                                                                const isFullAdmin = perm.bit === PERM_MANAGE_SERVER
                                                                                const fullAdminOn = (roleEditPermissions & PERM_MANAGE_SERVER) === PERM_MANAGE_SERVER
                                                                                const isDisabled = !isFullAdmin && fullAdminOn
                                                                                return (
                                                                                    <label
                                                                                        key={perm.bit}
                                                                                        style={{
                                                                                            display: 'flex',
                                                                                            alignItems: 'center',
                                                                                            gap: 6,
                                                                                            fontSize: 13,
                                                                                            opacity: isDisabled ? 0.85 : 1,
                                                                                        }}
                                                                                    >
                                                                                        <input
                                                                                            type="checkbox"
                                                                                            checked={
                                                                                                fullAdminOn && !isFullAdmin
                                                                                                    ? true
                                                                                                    : (roleEditPermissions & perm.bit) === perm.bit
                                                                                            }
                                                                                            disabled={isDisabled}
                                                                                            onChange={(e) => {
                                                                                                const checked = e.target.checked
                                                                                                setRoleEditPermissions((prev) => {
                                                                                                    const ADMIN_MASK =
                                                                                                        PERM_MANAGE_SERVER |
                                                                                                        PERM_MANAGE_ROLES |
                                                                                                        PERM_MANAGE_CHANNELS |
                                                                                                        PERM_MANAGE_MESSAGES |
                                                                                                        PERM_KICK_MEMBERS |
                                                                                                        PERM_VIEW_AUDIT_LOG
                                                                                                    if (isFullAdmin && !checked) {
                                                                                                        return prev & ~ADMIN_MASK
                                                                                                    }
                                                                                                    let next = checked ? prev | perm.bit : prev & ~perm.bit
                                                                                                    if ((next & PERM_MANAGE_SERVER) === PERM_MANAGE_SERVER) {
                                                                                                        next |= ADMIN_MASK
                                                                                                    }
                                                                                                    return next
                                                                                                })
                                                                                            }}
                                                                                        />
                                                                                        <span>{perm.label}</span>
                                                                                    </label>
                                                                                )
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                    <div
                                                                        style={{
                                                                            display: 'flex',
                                                                            justifyContent: 'space-between',
                                                                            marginTop: 12,
                                                                            gap: 8,
                                                                        }}
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-danger-outline btn-sm"
                                                                            style={{ fontSize: 12, padding: '4px 10px', minWidth: 0 }}
                                                                            disabled={
                                                                                !selectedRoleId ||
                                                                                !serverRoles.find((r) => r.id === selectedRoleId)
                                                                            }
                                                                            onClick={() => {
                                                                                if (!selectedRoleId) return
                                                                                setDeleteRoleConfirmId(selectedRoleId)
                                                                            }}
                                                                        >
                                                                            Delete role
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-primary btn-sm"
                                                                            style={{ fontSize: 12, padding: '4px 10px', minWidth: 0 }}
                                                                            disabled={
                                                                                !roleEditName.trim() ||
                                                                                rolesLoading ||
                                                                                !settingsServer
                                                                            }
                                                                            onClick={async () => {
                                                                                if (!settingsServer) return
                                                                                try {
                                                                                    let updated: ServerRole
                                                                                    const existing = selectedRoleId
                                                                                        ? serverRoles.find(
                                                                                              (r) => r.id === selectedRoleId,
                                                                                          )
                                                                                        : undefined
                                                                                    if (!existing) {
                                                                                        updated = await serverApi.createRole(
                                                                                            settingsServer.id,
                                                                                            roleEditName.trim(),
                                                                                            roleEditPermissions,
                                                                                            token,
                                                                                        )
                                                                                    } else {
                                                                                        updated = await serverApi.updateRole(
                                                                                            settingsServer.id,
                                                                                            selectedRoleId,
                                                                                            {
                                                                                                name: roleEditName.trim(),
                                                                                                permissions: roleEditPermissions,
                                                                                            },
                                                                                            token,
                                                                                        )
                                                                                    }
                                                                                    const roles = await serverApi.listRoles(
                                                                                        settingsServer.id,
                                                                                        token,
                                                                                    )
                                                                                    setServerRoles(roles)
                                                                                    // Collapse editor after successful save;
                                                                                    // user can re-open by clicking a role.
                                                                                    setSelectedRoleId(null)
                                                                                    setRoleEditName('')
                                                                                    setRoleEditPermissions(0)
                                                                                } catch (err) {
                                                                                    const message =
                                                                                        err instanceof Error
                                                                                            ? err.message
                                                                                            : 'Failed to save role.'
                                                                                    setRolesError(message)
                                                                                }
                                                                            }}
                                                                        >
                                                                            Save role
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                                                    Select a role from the list or create a new one.
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </section>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Footer removed; Overview card now owns its own Save button when needed. */}
                            </div>
                        </div>
                    )}
                    {showUnsavedServerSettingsConfirm && (
                        <div className="modal-overlay" onClick={() => setShowUnsavedServerSettingsConfirm(false)}>
                            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
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
                </>,
                document.body
            )}
        </div>
    )
}
