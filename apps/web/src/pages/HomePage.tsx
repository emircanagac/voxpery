import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, Bookmark, Check, Coffee, Compass, Github, Inbox, MessageSquarePlus, Send, UserMinus, Users, X } from 'lucide-react'
import {
  attachmentApi,
  dmApi,
  friendApi,
  serverApi,
  type Friend,
  type FriendRequest,
  type MessageWithAuthor,
} from '../api'
import ChatArea from '../components/ChatArea'
import SavedMediaCard from '../components/SavedMediaCard'
import type { StatusValue } from '../components/StatusIcon'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useSocketStore } from '../stores/socket'
import { useToastStore } from '../stores/toast'
import { MAX_CHAT_ATTACHMENT_BYTES, getMaxChatAttachmentMb } from '../attachments'
import {
  applyUploadedDraftAttachments,
  createUploadingDraftAttachments,
  getUploadedDraftAttachments,
  hasPendingDraftAttachments,
  markDraftAttachmentsFailed,
  setDraftAttachmentUploading,
  type DraftAttachmentItem,
} from '../draftAttachments'
import { mergeRemoteWithRetryableLocals } from '../messageResilience'
import { createSavedMediaItem } from '../savedMedia'
import { clearPendingSavedMediaJump, getPendingSavedMediaJump, setPendingSavedMediaJump } from '../savedMediaJump'
import { type SocialView, getPersistedSocialView, setPersistedSocialView } from '../socialView'

type FriendsFilter = 'all' | 'online' | 'requests'

const HIDDEN_DM_PEERS_KEY = 'voxpery-hidden-dm-peers'

function isDmAccessForbidden(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('No access') || msg.includes('403') || msg.includes('Forbidden')
}

function normalizePresence(status?: string | null): 'online' | 'dnd' | 'offline' {
  const normalized = (status ?? 'offline').toLowerCase()
  if (normalized === 'online' || normalized === 'dnd') return normalized
  return 'offline'
}

function presenceLabel(status?: string | null): string {
  const normalized = normalizePresence(status)
  if (normalized === 'dnd') return 'Do Not Disturb'
  if (normalized === 'offline') return 'Offline'
  return 'Online'
}

type UiDmMessage = MessageWithAuthor & {
  clientId?: string
  clientStatus?: 'sending' | 'failed'
  clientError?: string
}

function OnboardingCard({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions: Array<{ label: string; onClick: () => void; variant?: 'primary' | 'secondary'; icon?: ReactNode }>
}) {
  return (
    <div className="home-onboarding-card">
      <div className="home-onboarding-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="home-onboarding-actions">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`home-onboarding-btn ${action.variant === 'secondary' ? 'home-onboarding-btn--secondary' : ''}`}
            onClick={action.onClick}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function HomePage({ isMessagesView = true }: { isMessagesView?: boolean }) {
  const { token, user } = useAuthStore()
  const { subscribe, send, isConnected, onReconnect } = useSocketStore()
  const {
    servers: storeServers,
    setServersLoading,
    setServers,
    setActiveServer,
    setActiveChannel,
    dmUnread,
    clearDmUnread,
    activeDmChannelId,
    setActiveDmChannelId,
    setDmChannelIds,
    setIncomingRequestCount,
    friends: storeFriends,
    dmChannels: storeDmChannels,
    setFriends: setStoreFriends,
    setDmChannels: setStoreDmChannels,
    mobileSidebarPanel,
    setMobileSidebarPanel,
    savedMediaByUserId,
    unseenSavedMediaIdsByUserId,
    toggleSavedMedia,
    removeSavedMedia,
    markSavedMediaSeen,
  } = useAppStore(
    useShallow((s) => ({
      servers: s.servers,
      setServersLoading: s.setServersLoading,
      setServers: s.setServers,
      setActiveServer: s.setActiveServer,
      setActiveChannel: s.setActiveChannel,
      dmUnread: s.dmUnread,
      clearDmUnread: s.clearDmUnread,
      activeDmChannelId: s.activeDmChannelId,
      setActiveDmChannelId: s.setActiveDmChannelId,
      setDmChannelIds: s.setDmChannelIds,
      setIncomingRequestCount: s.setIncomingRequestCount,
      friends: s.friends,
      dmChannels: s.dmChannels,
      setFriends: s.setFriends,
      setDmChannels: s.setDmChannels,
      mobileSidebarPanel: s.mobileSidebarPanel,
      setMobileSidebarPanel: s.setMobileSidebarPanel,
      savedMediaByUserId: s.savedMediaByUserId,
      unseenSavedMediaIdsByUserId: s.unseenSavedMediaIdsByUserId,
      toggleSavedMedia: s.toggleSavedMedia,
      removeSavedMedia: s.removeSavedMedia,
      markSavedMediaSeen: s.markSavedMediaSeen,
    }))
  )
  const navigate = useNavigate()
  const location = useLocation()
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)

  const [view, setView] = useState<SocialView>('friends')
  const [friendsFilter, setFriendsFilter] = useState<FriendsFilter>('online')
  const [socialBootstrapLoading, setSocialBootstrapLoading] = useState(true)
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([])
  const [hiddenDmPeerIds, setHiddenDmPeerIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_DM_PEERS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      return []
    }
  })
  const [addFriendUsername, setAddFriendUsername] = useState('')
  const [addFriendMessage, setAddFriendMessage] = useState<string | null>(null)
  const [removeFriendTarget, setRemoveFriendTarget] = useState<Friend | null>(null)
  const [removingFriend, setRemovingFriend] = useState(false)
  const isMobileSocialSidebarOpen = mobileSidebarPanel === 'social'
  const friends = storeFriends
  const savedMedia = useMemo(
    () => (user?.id ? (savedMediaByUserId[user.id] ?? []) : []),
    [savedMediaByUserId, user?.id],
  )
  const unseenSavedCount = useMemo(
    () => (user?.id ? (unseenSavedMediaIdsByUserId[user.id] ?? []).length : 0),
    [unseenSavedMediaIdsByUserId, user?.id],
  )
  const savedMessageIds = useMemo(() => new Set(savedMedia.map((item) => item.message_id)), [savedMedia])
  const dmChannels = useMemo(
    () =>
      storeDmChannels.filter(
        (channel) => !hiddenDmPeerIds.includes(channel.peer_id) || (dmUnread[channel.id] ?? 0) > 0,
      ),
    [dmUnread, hiddenDmPeerIds, storeDmChannels]
  )

  // Single path /: restore the tab that was open when user left (Friends vs DM).
  useEffect(() => {
    if (location.pathname !== '/') return
    const openDmUserId = (location.state as { openDmUserId?: string } | null)?.openDmUserId
    if (openDmUserId && dmChannels.length > 0) {
      const channel = isUuid(openDmUserId)
        ? dmChannels.find((c) => c.peer_id === openDmUserId)
        : dmChannels.find((c) => c.peer_username === decodeURIComponent(openDmUserId))
      if (channel) {
        setHiddenDmPeerIds((prev) => prev.filter((id) => id !== channel.peer_id))
        setActiveDmChannelId(channel.id)
        setView('dm')
        setPersistedSocialView('dm')
        clearDmUnread(channel.id)
        navigate('/', { replace: true, state: {} })
      }
      return
    }
    const saved = getPersistedSocialView()
    if (saved === 'friends') setView('friends')
    else if (saved === 'saved') setView('saved')
    else if (saved === 'dm' && activeDmChannelId) setView('dm')
    else setView('friends')
  }, [location.pathname, location.state, activeDmChannelId, dmChannels, setActiveDmChannelId, clearDmUnread, navigate])

  const voxperyServer = useMemo(
    () => storeServers.find((s) => s.invite_code === 'voxpery' || s.name === 'Voxpery') ?? null,
    [storeServers],
  )
  const [dmMessages, setDmMessages] = useState<UiDmMessage[]>([])
  const [dmUnreadDividerCount, setDmUnreadDividerCount] = useState(0)
  const [dmConversationReady, setDmConversationReady] = useState(false)
  const [pendingSavedJumpMessageId, setPendingSavedJumpMessageId] = useState<string | null>(null)
  const [dmInput, setDmInput] = useState('')
  const [dmSearch, setDmSearch] = useState('')
  const [dmSearchResults, setDmSearchResults] = useState<MessageWithAuthor[] | null>(null)
  const [dmPins, setDmPins] = useState<MessageWithAuthor[]>([])
  const [editingDmMessageId, setEditingDmMessageId] = useState<string | null>(null)
  const [editingDmContent, setEditingDmContent] = useState('')
  const [deleteDmConfirmMessageId, setDeleteDmConfirmMessageId] = useState<string | null>(null)
  const [replyingToDm, setReplyingToDm] = useState<{ id: string; username: string; contentSnippet: string } | null>(null)
  const [dmDraftAttachments, setDmDraftAttachments] = useState<DraftAttachmentItem[]>([])
  const dmMessagesByChannelRef = useRef<Record<string, UiDmMessage[]>>({})
  const activeDmChannelIdRef = useRef(activeDmChannelId)
  const pushToast = useToastStore((s) => s.pushToast)
  useEffect(() => { activeDmChannelIdRef.current = activeDmChannelId }, [activeDmChannelId])

  // Use user so web works: on web token is null, auth is via httpOnly cookie.
  const refreshServersAndFriends = useCallback(async () => {
    if (!user) return
    setServersLoading(true)
    try {
      const [serverList, friendList, req, dms] = await Promise.all([
        serverApi.list(token),
        friendApi.list(token),
        friendApi.requests(token),
        dmApi.listChannels(token),
      ])
      setServers(serverList)
      setStoreFriends(friendList)
      setIncomingRequests(req.incoming)
      setIncomingRequestCount(req.incoming.length)
      setOutgoingRequests(req.outgoing)
      setStoreDmChannels(dms)
      setDmChannelIds(dms.map((d) => d.id))
    } finally {
      setServersLoading(false)
      setSocialBootstrapLoading(false)
    }
  }, [setDmChannelIds, setIncomingRequestCount, setServers, setServersLoading, setStoreFriends, setStoreDmChannels, token, user])

  useEffect(() => {
    try {
      localStorage.setItem(HIDDEN_DM_PEERS_KEY, JSON.stringify(hiddenDmPeerIds))
    } catch {
      // ignore
    }
  }, [hiddenDmPeerIds])

  useEffect(() => {
    if (storeDmChannels.length === 0) return
    const existingPeerIds = new Set(storeDmChannels.map((c) => c.peer_id))
    setHiddenDmPeerIds((prev) => prev.filter((id) => existingPeerIds.has(id)))
  }, [storeDmChannels])

  useEffect(() => {
    if (!user) return
    setSocialBootstrapLoading(true)
    refreshServersAndFriends().catch(console.error)
  }, [refreshServersAndFriends, user])

  const openOfficialCommunity = useCallback(async () => {
    if (voxperyServer) {
      setActiveServer(voxperyServer.id)
      navigate('/servers')
      return
    }
    try {
      const joined = await serverApi.join('voxpery', token)
      const list = await serverApi.list(token)
      setServers(list)
      setActiveServer(joined.id)
      navigate('/servers')
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'Join failed',
        message: err instanceof Error ? err.message : 'Could not join server.',
      })
    }
  }, [navigate, pushToast, setActiveServer, setServers, token, voxperyServer])

  const openSavedMediaSource = useCallback((item: (typeof savedMedia)[number]) => {
    if (item.source === 'dm') {
      setPendingSavedMediaJump({
        source: 'dm',
        channelId: item.channel_id,
        messageId: item.message_id,
      })
      if (item.peer_user_id) {
        setHiddenDmPeerIds((prev) => prev.filter((id) => id !== item.peer_user_id))
      }
      setActiveDmChannelId(item.channel_id)
      clearDmUnread(item.channel_id)
      setView('dm')
      setPersistedSocialView('dm')
      setMobileSidebarPanel('none')
      navigate('/', { replace: true })
      return
    }
    if (!item.server_id) return
    setPendingSavedMediaJump({
      source: 'server',
      channelId: item.channel_id,
      messageId: item.message_id,
    })
    setActiveServer(item.server_id)
    setActiveChannel(item.channel_id)
    setMobileSidebarPanel('none')
    navigate('/servers')
  }, [clearDmUnread, navigate, setActiveChannel, setActiveDmChannelId, setActiveServer, setMobileSidebarPanel])

  const onlineFriends = friends.filter((f) => f.status !== 'offline')
  const visibleFriends = friendsFilter === 'online' ? onlineFriends : friends
  const refreshActiveDmConversation = useCallback(async (channelId: string) => {
    if (!user) return
    setDmConversationReady(false)
    const cached = dmMessagesByChannelRef.current[channelId]
    setDmMessages(cached ?? [])
    try {
      const rows = await dmApi.listMessages(channelId, token)
      const ui = rows.map((m) => ({ ...m, clientId: undefined, clientStatus: undefined, clientError: undefined }))
      const merged = mergeRemoteWithRetryableLocals(ui, cached ?? [])
      dmMessagesByChannelRef.current[channelId] = merged
      setDmMessages(merged)
      setDmConversationReady(true)
    } catch (err) {
      setDmConversationReady(true)
      if (isDmAccessForbidden(err)) {
        setActiveDmChannelId(null)
        setView('friends')
        setPersistedSocialView('friends')
      } else {
        console.error(err)
      }
    }
  }, [token, user, setActiveDmChannelId, setView])

  const ensureDmMessageLoaded = useCallback(
    async (channelId: string, messageId: string) => {
      if (!user) return false
      let current = dmMessagesByChannelRef.current[channelId] ?? []
      if (current.length === 0) {
        const rows = await dmApi.listMessages(channelId, token)
        current = rows.map((m) => ({ ...m, clientId: undefined, clientStatus: undefined, clientError: undefined }))
      }
      if (current.some((message) => message.id === messageId)) {
        dmMessagesByChannelRef.current[channelId] = current
        setDmMessages(current)
        return true
      }
      let before = current[0]?.id
      while (before) {
        const rows = await dmApi.listMessages(channelId, token, before)
        if (rows.length === 0) break
        const older = rows
          .map((m) => ({ ...m, clientId: undefined, clientStatus: undefined, clientError: undefined }))
          .filter((message) => !current.some((existing) => existing.id === message.id))
        if (older.length === 0) break
        current = [...older, ...current]
        dmMessagesByChannelRef.current[channelId] = current
        setDmMessages(current)
        if (current.some((message) => message.id === messageId)) {
          return true
        }
        const nextBefore = current[0]?.id
        if (!nextBefore || nextBefore === before) break
        before = nextBefore
      }
      return current.some((message) => message.id === messageId)
    },
    [token, user],
  )

  useEffect(() => {
    if (!user || !activeDmChannelId) return
    void refreshActiveDmConversation(activeDmChannelId)
  }, [activeDmChannelId, refreshActiveDmConversation, user])

  useEffect(() => {
    if (!user || view !== 'saved') return
    markSavedMediaSeen(user.id)
  }, [markSavedMediaSeen, user, view])

  useEffect(() => {
    if (!user || !activeDmChannelId || view !== 'dm' || !dmConversationReady) return
    const pendingJump = getPendingSavedMediaJump()
    if (!pendingJump || pendingJump.source !== 'dm' || pendingJump.channelId !== activeDmChannelId) return
    let cancelled = false
    void (async () => {
      const found = await ensureDmMessageLoaded(activeDmChannelId, pendingJump.messageId)
      if (cancelled) return
      if (found) {
        setPendingSavedJumpMessageId(pendingJump.messageId)
      }
      clearPendingSavedMediaJump()
    })().catch(() => {
      clearPendingSavedMediaJump()
    })
    return () => {
      cancelled = true
    }
  }, [activeDmChannelId, dmConversationReady, ensureDmMessageLoaded, user, view])

  useEffect(() => {
    if (!user || !activeDmChannelId) return
    const q = dmSearch.trim()
    if (!q) {
      setDmSearchResults(null)
      return
    }
    const id = window.setTimeout(() => {
      dmApi.searchMessages(activeDmChannelId, q, token)
        .then((rows) => setDmSearchResults(rows))
        .catch(() => setDmSearchResults([]))
    }, 220)
    return () => window.clearTimeout(id)
  }, [activeDmChannelId, dmSearch, token, user])

  useEffect(() => {
    if (!user || !activeDmChannelId) return
    const channelId = activeDmChannelId
    dmApi
      .listPins(channelId, token)
      .then(setDmPins)
      .catch((err) => {
        if (isDmAccessForbidden(err)) {
          setActiveDmChannelId(null)
          setView('friends')
          setPersistedSocialView('friends')
        }
        setDmPins([])
      })
  }, [activeDmChannelId, token, user, setActiveDmChannelId, setView])

  const refreshDmPins = useCallback(() => {
    if (!activeDmChannelId) return
    dmApi.listPins(activeDmChannelId, token).then(setDmPins).catch(() => setDmPins([]))
  }, [activeDmChannelId, token])

  useEffect(() => {
    if (!user) return
    const unsubscribe = onReconnect(() => {
      void refreshServersAndFriends().catch(() => {})

      const currentDmChannelId = activeDmChannelIdRef.current
      if (currentDmChannelId) {
        void refreshActiveDmConversation(currentDmChannelId)
        dmApi.listPins(currentDmChannelId, token).then(setDmPins).catch(() => setDmPins([]))
      }
    })
    return () => unsubscribe()
  }, [onReconnect, refreshActiveDmConversation, refreshServersAndFriends, token, user])

  const handlePinDmMessage = useCallback(async (messageId: string) => {
    if (!user || !activeDmChannelId) return
    try {
      await dmApi.pinMessage(activeDmChannelId, messageId, token)
      refreshDmPins()
    } catch (e) {
      pushToast({ level: 'error', title: 'Pin failed', message: e instanceof Error ? e.message : 'Failed to pin' })
    }
  }, [activeDmChannelId, token, user, refreshDmPins, pushToast])

  const handleUnpinDmMessage = useCallback(async (messageId: string) => {
    if (!user || !activeDmChannelId) return
    try {
      await dmApi.unpinMessage(activeDmChannelId, messageId, token)
      refreshDmPins()
    } catch (e) {
      pushToast({ level: 'error', title: 'Unpin failed', message: e instanceof Error ? e.message : 'Failed to unpin' })
    }
  }, [activeDmChannelId, token, user, refreshDmPins, pushToast])

  const handleToggleDmReaction = useCallback(async (messageId: string, emoji: string, reacted: boolean) => {
    if (!user) return
    try {
      const updated = reacted
        ? await dmApi.removeReaction(messageId, emoji, token)
        : await dmApi.addReaction(messageId, emoji, token)
      setDmMessages((prev) => {
        const next = prev.map((m) => (m.id === updated.id ? updated : m))
        if (activeDmChannelId) {
          dmMessagesByChannelRef.current[activeDmChannelId] = next
        }
        return next
      })
    } catch (e) {
      pushToast({
        level: 'error',
        title: 'Reaction failed',
        message: e instanceof Error ? e.message : 'Could not update reaction.',
      })
    }
  }, [token, user, pushToast, activeDmChannelId])

  /* When switching to DM: lock window scroll and blur so nothing triggers page shift */
  useEffect(() => {
    if (view !== 'dm') return
    window.scrollTo(0, 0)
      ; (document.activeElement as HTMLElement | null)?.blur()
  }, [view])

  /* Mark DM as read whenever the conversation is visible (fixes badge when landing on / with same DM still in state) */
  useEffect(() => {
    if (view === 'dm' && activeDmChannelId) {
      const unreadCount = useAppStore.getState().dmUnread[activeDmChannelId] ?? 0
      setDmUnreadDividerCount(unreadCount > 0 ? unreadCount : 0)
      clearDmUnread(activeDmChannelId)
      return
    }

    setDmUnreadDividerCount(0)
  }, [view, activeDmChannelId, clearDmUnread, location.pathname])

  useEffect(() => {
    if (!isConnected || dmChannels.length === 0) return
    const ids = dmChannels.map((c) => c.id)
    send('Subscribe', { channel_ids: ids })
    return () => {
      send('Unsubscribe', { channel_ids: ids })
    }
  }, [dmChannels, isConnected, send])

  useEffect(() => {
    const unsub = subscribe((evt: unknown) => {
      const e = evt as { type?: string; data?: { channel_id?: string; message?: unknown } }
      if (e?.type !== 'NewMessage') return
      const payload = e.data
      if (!payload) return
      const channelId = payload.channel_id as string
      if (channelId !== activeDmChannelIdRef.current) return
      const incoming = payload.message as MessageWithAuthor
      setDmMessages((prev) => {
        const existingIdx = prev.findIndex((m) => m.id === incoming.id)
        if (existingIdx >= 0) {
          const next = [...prev]
          next[existingIdx] = incoming
          dmMessagesByChannelRef.current[channelId] = next
          return next
        }
        const isFromMe = incoming.author?.user_id === user?.id
        const sendingIdx = prev.findIndex((m) => m.clientStatus === 'sending' && m.author?.user_id === user?.id)
        if (isFromMe && sendingIdx >= 0) {
          const next = [...prev]
          next[sendingIdx] = incoming
          dmMessagesByChannelRef.current[channelId] = next
          return next
        }
        const next = [...prev, incoming]
        dmMessagesByChannelRef.current[channelId] = next
        return next
      })
    })
    return () => unsub()
  }, [subscribe, user?.id])

  // Keep friends list and DM channel peer status in sync with PresenceUpdate (online/offline)
  useEffect(() => {
    const unsub = subscribe((evt: unknown) => {
      const e = evt as { type?: string; data?: { user_id?: string; status?: string } }
      if (e?.type !== 'PresenceUpdate') return
      const { user_id, status } = e.data ?? {}
      if (!user_id || status == null) return
      const prevFriends = useAppStore.getState().friends
      if (prevFriends.some((f) => f.id === user_id)) {
        setStoreFriends(prevFriends.map((f) => (f.id === user_id ? { ...f, status } : f)))
      }
      const prevChannels = useAppStore.getState().dmChannels
      if (prevChannels.some((c) => c.peer_id === user_id)) {
        setStoreDmChannels(prevChannels.map((c) => (c.peer_id === user_id ? { ...c, peer_status: status } : c)))
      }
    })
    return () => unsub()
  }, [setStoreFriends, setStoreDmChannels, subscribe])

  // Instant social refresh when friend requests/friendships change on either side.
  useEffect(() => {
    if (!user) return
    const unsub = subscribe((evt: unknown) => {
      const e = evt as { type?: string; data?: { user_id?: string } }
      if (e?.type !== 'FriendUpdate') return
      const uid = e.data?.user_id
      if (uid !== user.id) return
      refreshServersAndFriends().catch(() => { })
    })
    return () => unsub()
  }, [refreshServersAndFriends, subscribe, user])

  const openMessageForFriend = async (friendId: string) => {
    if (!user) return
    const channel = await dmApi.getOrCreateChannel(friendId, token)
    setHiddenDmPeerIds((prev) => prev.filter((id) => id !== channel.peer_id))
    setView('dm')
    setPersistedSocialView('dm')
    setActiveDmChannelId(channel.id)
    clearDmUnread(channel.id)
    const prev = useAppStore.getState().dmChannels
    if (!prev.some((c) => c.id === channel.id)) {
      setStoreDmChannels([channel, ...prev])
    }
    navigate('/')
  }

  const sendFriendRequest = async () => {
    if (!user || !addFriendUsername.trim()) return
    setAddFriendMessage(null)
    try {
      await friendApi.sendRequest(addFriendUsername.trim(), token)
      setAddFriendMessage('Friend request sent.')
      setAddFriendUsername('')
      const req = await friendApi.requests(token)
      setIncomingRequests(req.incoming)
      setIncomingRequestCount(req.incoming.length)
      setOutgoingRequests(req.outgoing)
    } catch (err: unknown) {
      setAddFriendMessage((err as Error)?.message ?? 'Failed to send request')
    }
  }

  const acceptRequest = async (requestId: string) => {
    if (!user) return
    await friendApi.acceptRequest(requestId, token)
    await refreshServersAndFriends()
  }

  const rejectRequest = async (requestId: string) => {
    if (!user) return
    await friendApi.rejectRequest(requestId, token)
    const req = await friendApi.requests(token)
    setIncomingRequests(req.incoming)
    setIncomingRequestCount(req.incoming.length)
    setOutgoingRequests(req.outgoing)
  }

  const cancelOutgoingRequest = async (requestId: string) => {
    if (!user) return
    await friendApi.rejectRequest(requestId, token)
    const req = await friendApi.requests(token)
    setIncomingRequests(req.incoming)
    setIncomingRequestCount(req.incoming.length)
    setOutgoingRequests(req.outgoing)
  }

  const confirmRemoveFriend = async () => {
    if (!user || !removeFriendTarget || removingFriend) return
    setRemovingFriend(true)
    try {
      await friendApi.remove(removeFriendTarget.id, token)
      const removedId = removeFriendTarget.id
      setStoreFriends(useAppStore.getState().friends.filter((f) => f.id !== removedId))
      setRemoveFriendTarget(null)
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'Remove failed',
        message: err instanceof Error ? err.message : 'Could not remove friend.',
      })
    } finally {
      setRemovingFriend(false)
    }
  }

  const handleDmAttachmentPick = async (files: FileList | null) => {
    if (!files) return
    const incoming = Array.from(files)
    const remainingSlots = Math.max(0, 4 - dmDraftAttachments.length)
    if (remainingSlots === 0) {
      pushToast({
        level: 'error',
        title: 'Upload blocked',
        message: 'Maximum 4 attachments per message.',
      })
      return
    }
    const list = incoming.slice(0, remainingSlots)
    if (incoming.length > remainingSlots) {
      pushToast({
        level: 'error',
        title: 'Upload blocked',
        message: 'Maximum 4 attachments per message.',
      })
    }
    const allowed: File[] = []
    const oversized: string[] = []
    for (const f of list) {
      if (f.size > MAX_CHAT_ATTACHMENT_BYTES) {
        oversized.push(f.name)
        continue
      }
      allowed.push(f)
    }
    if (oversized.length > 0) {
      const maxMb = getMaxChatAttachmentMb()
      pushToast({
        level: 'error',
        title: 'Upload blocked',
        message: `Maximum ${maxMb} MB per file. Too large: ${oversized.join(', ')}`,
      })
    }
    if (allowed.length === 0) return
    const pending = createUploadingDraftAttachments(allowed)
    const pendingIds = pending.map((attachment) => attachment.localId)
    setDmDraftAttachments((prev) => [...prev, ...pending].slice(0, 4))
    try {
      const uploaded = await attachmentApi.uploadFiles(allowed, token)
      setDmDraftAttachments((prev) => applyUploadedDraftAttachments(prev, pendingIds, uploaded))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not upload attachment(s).'
      setDmDraftAttachments((prev) => markDraftAttachmentsFailed(prev, pendingIds, errorMessage))
      pushToast({
        level: 'error',
        title: 'Upload failed',
        message: errorMessage,
      })
    }
  }

  const handleRetryDmAttachment = useCallback(async (localId: string) => {
    const target = dmDraftAttachments.find((attachment) => attachment.localId === localId)
    if (!target?.file) return
    setDmDraftAttachments((prev) => setDraftAttachmentUploading(prev, localId))
    try {
      const [uploaded] = await attachmentApi.uploadFiles([target.file], token)
      if (!uploaded) throw new Error('Could not upload attachment.')
      setDmDraftAttachments((prev) => applyUploadedDraftAttachments(prev, [localId], [uploaded]))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Could not upload attachment(s).'
      setDmDraftAttachments((prev) => markDraftAttachmentsFailed(prev, [localId], errorMessage))
      pushToast({
        level: 'error',
        title: 'Upload failed',
        message: errorMessage,
      })
    }
  }, [dmDraftAttachments, pushToast, token])

  const handleSendDm = async (_e?: FormEvent, forceContent?: string) => {
    if (!user || !activeDmChannelId) return
    if (hasPendingDraftAttachments(dmDraftAttachments)) {
      pushToast({
        level: 'error',
        title: 'Attachment still pending',
        message: 'Finish uploading attachments or retry failed ones before sending.',
      })
      return
    }
    const inputValue = typeof forceContent === 'string' ? forceContent : dmInput
    const bodyText = inputValue.trim()
    const attachmentsToSend = getUploadedDraftAttachments(dmDraftAttachments)
    if (!bodyText && attachmentsToSend.length === 0) return
    const content = replyingToDm
      ? `> @${replyingToDm.username}: ${replyingToDm.contentSnippet}\n\n${bodyText}`
      : bodyText
    setReplyingToDm(null)
    setDmInput('')
    setDmDraftAttachments([])
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimisticId = `local-${clientId}`
    const optimistic: UiDmMessage = {
      id: optimisticId,
      channel_id: activeDmChannelId,
      content,
      attachments: attachmentsToSend,
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
    setDmMessages((prev) => {
      const next = [...prev, optimistic]
      dmMessagesByChannelRef.current[activeDmChannelId] = next
      return next
    })
    try {
      const msg = await dmApi.sendMessage(activeDmChannelId, content, attachmentsToSend, token)
      clearDmUnread(activeDmChannelId)
      setDmMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        const idx = prev.findIndex((m) => m.clientId === clientId)
        if (idx < 0) {
          const next = [...prev, msg]
          dmMessagesByChannelRef.current[activeDmChannelId] = next
          return next
        }
        const next = [...prev]
        next[idx] = msg
        dmMessagesByChannelRef.current[activeDmChannelId] = next
        return next
      })
    } catch (err) {
      setDmMessages((prev) => {
        const next = prev.map((m) =>
          m.clientId === clientId
            ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Send failed' }
            : m
        )
        dmMessagesByChannelRef.current[activeDmChannelId] = next
        return next
      })
    }
  }

  const handleRetryDmMessage = useCallback(
    async (clientId: string) => {
      if (!user || !activeDmChannelId) return
      const target = dmMessages.find((m) => m.clientId === clientId)
      if (!target || target.clientStatus !== 'failed') return
      setDmMessages((prev) => {
        const next = prev.map((m) =>
          m.clientId === clientId ? { ...m, clientStatus: 'sending' as const, clientError: undefined } : m
        )
        dmMessagesByChannelRef.current[activeDmChannelId] = next
        return next
      })
      try {
        const msg = await dmApi.sendMessage(activeDmChannelId, target.content, target.attachments ?? [], token)
        clearDmUnread(activeDmChannelId)
        setDmMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) {
            const next = prev.filter((m) => m.clientId !== clientId)
            dmMessagesByChannelRef.current[activeDmChannelId] = next
            return next
          }
          const next = prev.map((m) => (m.clientId === clientId ? msg : m))
          dmMessagesByChannelRef.current[activeDmChannelId] = next
          return next
        })
      } catch (err) {
        setDmMessages((prev) => {
          const next = prev.map((m) =>
            m.clientId === clientId
              ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Retry failed' }
              : m
          )
          dmMessagesByChannelRef.current[activeDmChannelId] = next
          return next
        })
      }
    },
    [token, activeDmChannelId, dmMessages, user, clearDmUnread]
  )

  const handleToggleSaveDmMessage = useCallback((msg: MessageWithAuthor) => {
    if (!user?.id || !activeDmChannelId || !Array.isArray(msg.attachments) || msg.attachments.length === 0) return
    const dmChannel = storeDmChannels.find((channel) => channel.id === activeDmChannelId)
    if (!dmChannel) return
    toggleSavedMedia(
      user.id,
      createSavedMediaItem(msg, {
        kind: 'dm',
        channelId: dmChannel.id,
        channelName: dmChannel.peer_username,
        peerUserId: dmChannel.peer_id,
        peerUsername: dmChannel.peer_username,
      }),
    )
  }, [activeDmChannelId, storeDmChannels, toggleSavedMedia, user?.id])



  const displayedDmMessages = dmSearch.trim() ? (dmSearchResults ?? []) : dmMessages

  const saveDmEdit = useCallback(async () => {
    if (!user || !editingDmMessageId || !editingDmContent.trim()) return
    try {
      const updated = await dmApi.editMessage(editingDmMessageId, editingDmContent.trim(), token)
      setDmMessages((prev) => {
        const next = prev.map((m) => (m.id === updated.id ? updated : m))
        if (activeDmChannelId) dmMessagesByChannelRef.current[activeDmChannelId] = next
        return next
      })
      if (dmSearch.trim()) {
        setDmSearchResults((prev) => (prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : null))
      }
      setEditingDmMessageId(null)
      setEditingDmContent('')
    } catch {
      // could toast
    }
  }, [user, token, editingDmMessageId, editingDmContent, activeDmChannelId, dmSearch])

  const removeDmMessage = useCallback(
    async (messageId: string) => {
      if (!user) return
      const isLocalOptimistic = messageId.startsWith('local-')
      if (isLocalOptimistic) {
        setDmMessages((prev) => {
          const next = prev.filter((m) => m.id !== messageId)
          if (activeDmChannelId) dmMessagesByChannelRef.current[activeDmChannelId] = next
          return next
        })
        setDeleteDmConfirmMessageId(null)
        return
      }
      try {
        await dmApi.deleteMessage(messageId, token)
        setDmMessages((prev) => {
          const next = prev.filter((m) => m.id !== messageId)
          if (activeDmChannelId) dmMessagesByChannelRef.current[activeDmChannelId] = next
          return next
        })
        if (dmSearch.trim()) {
          setDmSearchResults((prev) => (prev ? prev.filter((m) => m.id !== messageId) : null))
        }
        setDeleteDmConfirmMessageId(null)
      } catch {
        setDeleteDmConfirmMessageId(null)
      }
    },
    [user, token, activeDmChannelId, dmSearch]
  )



  return (
    <div className={`home-page ${isMobileSocialSidebarOpen ? 'home-page--mobile-sidebar-open' : ''}`}>
      <aside className={`social-sidebar ${isMobileSocialSidebarOpen ? 'social-sidebar--mobile-open' : ''}`}>
        <div className="social-sidebar-header">Social</div>
        <button
          type="button"
          className={`social-nav-item ${view === 'friends' ? 'active' : ''}`}
          onClick={() => {
            setView('friends')
            setPersistedSocialView('friends')
            if (location.pathname !== '/') navigate('/')
            setMobileSidebarPanel('none')
          }}
        >
          <Users size={14} />
          <span className="social-nav-item-label">Friends</span>
          {incomingRequests.length > 0 && <span className="notif-dot" />}
        </button>
        <button
          type="button"
          className={`social-nav-item ${view === 'saved' ? 'active' : ''}`}
          onClick={() => {
            setView('saved')
            setPersistedSocialView('saved')
            if (location.pathname !== '/') navigate('/')
            setMobileSidebarPanel('none')
          }}
        >
          <Bookmark size={14} />
          <span className="social-nav-item-label">Saved</span>
          {unseenSavedCount > 0 && <span className="home-chip-badge">{unseenSavedCount}</span>}
        </button>

        <div className="social-sidebar-divider" />
        <div className="social-sidebar-title">Direct Messages</div>
        {socialBootstrapLoading ? (
          <div className="home-sidebar-skeleton" aria-hidden="true">
            <div className="home-sidebar-skeleton-row" />
            <div className="home-sidebar-skeleton-row" />
            <div className="home-sidebar-skeleton-row short" />
          </div>
        ) : dmChannels.length === 0 ? (
          <div className="home-empty-row home-empty-row--sidebar">
            No DMs yet
            <span>
              {friends.length > 0
                ? 'Pick a friend to start your first conversation.'
                : 'Add a friend to start your first conversation.'}
            </span>
          </div>
        ) : (
          dmChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={`social-dm-item ${view === 'dm' && activeDmChannelId === channel.id ? 'active' : ''}`}
              onClick={(e) => {
                ; (e.currentTarget as HTMLButtonElement).blur()
                setHiddenDmPeerIds((prev) => prev.filter((id) => id !== channel.peer_id))
                setView('dm')
                setActiveDmChannelId(channel.id)
                setPersistedSocialView('dm')
                clearDmUnread(channel.id)
                if (location.pathname !== '/') navigate('/')
                setMobileSidebarPanel('none')
              }}
            >
              <div className={`home-member-avatar avatar-status-${(channel.peer_status ?? 'offline') as StatusValue}`}>
                {channel.peer_avatar_url ? (
                  <img src={channel.peer_avatar_url} alt="" />
                ) : (
                  channel.peer_username.charAt(0).toUpperCase()
                )}
              </div>
              <div className="home-member-meta">
                <div>{channel.peer_username}</div>
                <span>
                  <span className={`home-presence-pill home-presence-pill-${normalizePresence(channel.peer_status)}`}>
                    <span className="home-presence-pill-dot" aria-hidden />
                    {presenceLabel(channel.peer_status)}
                  </span>
                </span>
              </div>
              <div className="social-dm-actions">
                {(dmUnread[channel.id] ?? 0) > 0 && <span className="social-dm-unread">{dmUnread[channel.id]}</span>}
                <div
                  role="button"
                  tabIndex={0}
                  className="home-member-action"
                  title="Hide conversation"
                  aria-label={`Hide DM with ${channel.peer_username}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setHiddenDmPeerIds((prev) => {
                      if (prev.includes(channel.peer_id)) return prev
                      return [...prev, channel.peer_id]
                    })
                    if (activeDmChannelId === channel.id) {
                      setView('friends')
                      setActiveDmChannelId(null)
                      setPersistedSocialView('friends')
                      navigate('/')
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      setHiddenDmPeerIds((prev) => {
                        if (prev.includes(channel.peer_id)) return prev
                        return [...prev, channel.peer_id]
                      })
                      if (activeDmChannelId === channel.id) {
                        setView('friends')
                        setActiveDmChannelId(null)
                        setPersistedSocialView('friends')
                        navigate('/')
                      }
                    }
                  }}
                >
                  <X size={14} />
                </div>
              </div>
            </button>
          ))
        )}

      </aside>
      {isMobileSocialSidebarOpen && (
        <button
          type="button"
          className="mobile-sidebar-backdrop"
          aria-label="Close social sidebar"
          onClick={() => setMobileSidebarPanel('none')}
        />
      )}

      <section className={`home-main${view === 'dm' ? ' home-main-dm' : ''}`}>
        <div className={`social-content${view === 'dm' ? ' social-content-dm' : ''}`}>
          {view === 'friends' && (
            <>
              <div className="home-chip-row">
                <button
                  type="button"
                  className={`home-chip ${friendsFilter === 'online' ? 'active' : ''}`}
                  onClick={() => setFriendsFilter('online')}
                >
                  <Activity size={14} />
                  Online
                </button>
                <button
                  type="button"
                  className={`home-chip ${friendsFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setFriendsFilter('all')}
                >
                  <Users size={14} />
                  All
                </button>
                <button
                  type="button"
                  className={`home-chip ${friendsFilter === 'requests' ? 'active' : ''}`}
                  onClick={() => setFriendsFilter('requests')}
                >
                  <MessageSquarePlus size={14} />
                  Requests
                  {incomingRequests.length > 0 && (
                    <span className="home-chip-badge">{incomingRequests.length}</span>
                  )}
                </button>
              </div>
              {friendsFilter === 'requests' ? (
                <>
                  <div className="home-list-group home-requests-add-card">
                    <div className="home-list-title">Add a Friend</div>
                    <div className="home-add-row">
                      <input
                        className="home-search"
                        placeholder="Enter username"
                        value={addFriendUsername}
                        onChange={(e) => setAddFriendUsername(e.target.value)}
                      />
                      <button type="button" className="home-send-request-btn" onClick={sendFriendRequest}>
                        Send Request
                      </button>
                    </div>
                    {addFriendMessage && <div className="home-empty-row home-add-message">{addFriendMessage}</div>}
                    <p className="home-requests-hint">Enter a username above to send a friend request.</p>
                  </div>
                  <div className="home-list-group">
                    <div className="home-list-title home-list-title-with-icon">
                      <Inbox size={16} />
                      <span>Incoming</span>
                      <span className="home-list-count">{incomingRequests.length}</span>
                    </div>
                    {incomingRequests.length === 0 ? (
                      <div className="home-empty-row home-empty-muted">No incoming requests.</div>
                    ) : (
                      incomingRequests.map((r) => (
                        <div key={r.id} className="home-request-row">
                          <span>{r.requester_username}</span>
                          <div className="home-request-actions">
                            <button type="button" className="home-request-btn accept" onClick={() => acceptRequest(r.id)}>
                              <Check size={14} />
                            </button>
                            <button type="button" className="home-request-btn reject" onClick={() => rejectRequest(r.id)}>
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                    <div className="home-list-title home-list-title-with-icon home-list-title-secondary">
                      <Send size={16} />
                      <span>Outgoing</span>
                      <span className="home-list-count">{outgoingRequests.length}</span>
                    </div>
                    {outgoingRequests.length === 0 ? (
                      <div className="home-empty-row home-empty-muted">No outgoing requests.</div>
                    ) : (
                      outgoingRequests.map((r) => (
                        <div key={`out-${r.id}`} className="home-request-row home-request-row-outgoing">
                          <span>Pending to <strong>{r.receiver_username}</strong></span>
                          <div className="home-request-actions">
                            <button
                              type="button"
                              className="home-request-btn reject"
                              title="Cancel request"
                              aria-label={`Cancel request to ${r.receiver_username}`}
                              onClick={() => void cancelOutgoingRequest(r.id)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
              <div className="home-list-group">
                <div className="home-list-title">
                  {friendsFilter === 'online'
                    ? `Online Friends — ${onlineFriends.length}`
                    : `All Friends — ${friends.length}`}
                </div>
                {socialBootstrapLoading ? (
                  <div className="home-list-skeleton" aria-hidden="true">
                    <div className="home-list-skeleton-row" />
                    <div className="home-list-skeleton-row" />
                    <div className="home-list-skeleton-row" />
                  </div>
                ) : visibleFriends.length === 0 ? (
                  friends.length === 0 ? (
                    <OnboardingCard
                      title="Start your social graph"
                      description="Add a friend or jump into the official Voxpery community so you have someone to message right away."
                      actions={[
                        {
                          label: 'Add a friend',
                          onClick: () => setFriendsFilter('requests'),
                          icon: <MessageSquarePlus size={14} />,
                        },
                        {
                          label: voxperyServer ? 'Open community' : 'Join community',
                          onClick: () => {
                            void openOfficialCommunity()
                          },
                          variant: 'secondary',
                          icon: <Compass size={14} />,
                        },
                      ]}
                    />
                  ) : (
                    <div className="home-empty-row">
                      {friendsFilter === 'online'
                        ? "No one's online right now."
                        : 'No friends found for this view.'}
                    </div>
                  )
                ) : (
                  visibleFriends.map((friend) => {
                    return (
                      <div
                        key={friend.id}
                        className="home-member-row is-clickable"
                        onClick={() => openMessageForFriend(friend.id)}
                      >
                        <div className={`home-member-avatar avatar-status-${['online', 'dnd', 'offline'].includes((friend.status ?? '').toLowerCase()) ? (friend.status ?? 'offline').toLowerCase() : 'offline'}`}>
                          {friend.avatar_url ? (
                            <img src={friend.avatar_url} alt="" />
                          ) : (
                            friend.username.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="home-member-meta">
                          <div>{friend.username}</div>
                          <span>
                            <span className={`home-presence-pill home-presence-pill-${normalizePresence(friend.status)}`}>
                              <span className="home-presence-pill-dot" aria-hidden />
                              {presenceLabel(friend.status)}
                            </span>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="home-member-action home-member-action--trailing danger"
                          title="Remove friend"
                          onClick={(e) => {
                            e.stopPropagation()
                            setRemoveFriendTarget(friend)
                          }}
                        >
                          <UserMinus size={15} />
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
              )}
            </>
          )}

          {view === 'saved' && (
            <div className="home-list-group home-list-group--saved">
              <div className="home-list-title">Saved media — {savedMedia.length}</div>
              {savedMedia.length === 0 ? (
                <OnboardingCard
                  title="Save media for later"
                  description="Bookmark images and files from chats so you can jump back to them from one place."
                  actions={[
                    {
                      label: 'Open friends',
                      onClick: () => {
                        setView('friends')
                        setPersistedSocialView('friends')
                      },
                      icon: <Users size={14} />,
                    },
                    {
                      label: voxperyServer ? 'Open community' : 'Join community',
                      onClick: () => {
                        void openOfficialCommunity()
                      },
                      variant: 'secondary',
                      icon: <Compass size={14} />,
                    },
                  ]}
                />
              ) : (
                <div className="saved-media-list">
                  {savedMedia.map((item) => (
                    <SavedMediaCard
                      key={item.id}
                      item={item}
                      onOpen={() => openSavedMediaSource(item)}
                      onRemove={() => {
                        if (!user?.id) return
                        removeSavedMedia(user.id, item.id)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {view === 'dm' && (() => {
            const dmChannel = activeDmChannelId ? storeDmChannels.find((c) => c.id === activeDmChannelId) : null
            if (socialBootstrapLoading) {
              return (
                <div className="home-dm-chat">
                  <div className="home-list-skeleton" aria-hidden="true" style={{ padding: 24 }}>
                    <div className="home-list-skeleton-row" />
                    <div className="home-list-skeleton-row" />
                    <div className="home-list-skeleton-row" />
                  </div>
                </div>
              )
            }
            if (!dmChannel) {
              return (
                <div className="home-dm-chat">
                  <div className="welcome-screen" style={{ padding: 24 }}>
                    <OnboardingCard
                      title="Start a conversation"
                      description={
                        friends.length > 0
                          ? 'Pick a friend from the sidebar or jump back to Friends to start your first DM.'
                          : 'You need at least one friend before you can start a DM.'
                      }
                      actions={[
                        {
                          label: friends.length > 0 ? 'Open friends' : 'Add a friend',
                          onClick: () => {
                            setView('friends')
                            setPersistedSocialView('friends')
                            setFriendsFilter(friends.length > 0 ? 'all' : 'requests')
                          },
                          icon: <Users size={14} />,
                        },
                        {
                          label: voxperyServer ? 'Open community' : 'Join community',
                          onClick: () => {
                            void openOfficialCommunity()
                          },
                          variant: 'secondary',
                          icon: <ArrowRight size={14} />,
                        },
                      ]}
                    />
                  </div>
                </div>
              )
            }
            const syntheticChannel = {
              id: dmChannel.id,
              server_id: '',
              name: dmChannel.peer_username,
              channel_type: 'text' as const,
              position: 0,
            }
            return (
              <ChatArea
                activeChannel={syntheticChannel}
                messages={displayedDmMessages}
                unreadDividerCount={dmUnreadDividerCount}
                draftAttachments={dmDraftAttachments}
                messageInput={dmInput}
                onPickAttachments={handleDmAttachmentPick}
                onRemoveAttachment={(index) => setDmDraftAttachments((prev) => prev.filter((_, i) => i !== index))}
                onRetryAttachment={handleRetryDmAttachment}
                onMessageInputChange={setDmInput}
                onSendMessage={handleSendDm}
                onRetryMessage={handleRetryDmMessage}
                onDeleteMessage={setDeleteDmConfirmMessageId}
                onToggleSaveMessage={handleToggleSaveDmMessage}
                savedMessageIds={savedMessageIds}
                editingMessageId={editingDmMessageId}
                editingContent={editingDmContent}
                onEditMessage={(msg) => {
                  setEditingDmMessageId(msg.id)
                  setEditingDmContent(msg.contentToEdit ?? msg.content)
                }}
                onEditingContentChange={setEditingDmContent}
                onSaveEdit={saveDmEdit}
                onCancelEdit={() => {
                  setEditingDmMessageId(null)
                  setEditingDmContent('')
                }}
                currentUserId={user?.id ?? null}
                isDm
                replyingTo={replyingToDm}
                onCancelReply={() => setReplyingToDm(null)}
                onReplyToMessage={(msg) => {
                  const username = msg.author?.username ?? 'User'
                  const snippet = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content
                  setReplyingToDm({ id: msg.id, username, contentSnippet: snippet })
                }}
                isViewActive={isMessagesView}
                searchQuery={dmSearch}
                onSearchChange={setDmSearch}
                pinnedMessages={dmPins}
                onPinMessage={handlePinDmMessage}
                onUnpinMessage={handleUnpinDmMessage}
                onToggleReaction={handleToggleDmReaction}
                jumpToMessageId={pendingSavedJumpMessageId}
                onJumpToMessageHandled={() => setPendingSavedJumpMessageId(null)}
              />
            )
          })()}
        </div>
      </section>

      {removeFriendTarget && createPortal(
        <div className="modal-overlay" onClick={() => !removingFriend && setRemoveFriendTarget(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Remove friend?</h2>
            <p>
              {`This will remove ${removeFriendTarget.username} from your friends list.`}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRemoveFriendTarget(null)}
                disabled={removingFriend}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmRemoveFriend}
                disabled={removingFriend}
              >
                {removingFriend ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <aside className="home-side">
        <div className="community-note community-intro">
          <h3>What is Voxpery?</h3>
          <p>
            Voice and text chat for friends and communities. Servers, voice channels, screen share — all in one place.
          </p>
        </div>

        <div className="community-card">
          <div className="community-card-badge">
            <Compass size={14} />
            Official Community
          </div>
          <h2>Voxpery Community</h2>
          <p>
            {voxperyServer
              ? 'Updates, announcements, and discussions in the official server.'
              : 'Join to connect with others, get updates, and join discussions.'}
          </p>
          <button
            type="button"
            className="community-open-btn"
            onClick={() => {
              void openOfficialCommunity()
            }}
          >
            <span className="community-btn-emoji" aria-hidden>🦊</span>
            {voxperyServer ? 'Open Server' : 'Join Server'}
          </button>
        </div>

        <div className="community-card community-card-github">
          <div className="community-card-badge">
            <Github size={14} />
            Open Source
          </div>
          <h2>View the code</h2>
          <p>
            Open source. Browse, report issues, or contribute on GitHub.
          </p>
          <a
            href="https://github.com/emircanagac/voxpery"
            target="_blank"
            rel="noopener noreferrer"
            className="community-open-btn"
          >
            <Github size={16} />
            View on GitHub
          </a>
        </div>

        <div className="community-card community-card-support">
          <div className="community-card-badge">
            <Coffee size={14} />
            Support
          </div>
          <h2>Support the project</h2>
          <p>
            Server is volunteer-run. Support with a one-time donation if you find it useful.
          </p>
          <a
            href="https://www.buymeacoffee.com/emircanagac"
            target="_blank"
            rel="noopener noreferrer"
            className="community-open-btn"
          >
            <Coffee size={16} />
            Support Voxpery
          </a>
        </div>
      </aside>

      {deleteDmConfirmMessageId &&
        createPortal(
          <div className="modal-overlay" onClick={() => setDeleteDmConfirmMessageId(null)}>
            <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
              <h2>Delete message</h2>
              <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                Are you sure you want to delete this message?
              </p>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteDmConfirmMessageId(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" onClick={() => void removeDmMessage(deleteDmConfirmMessageId)}>
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}

