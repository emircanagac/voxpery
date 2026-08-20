import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { Activity, ArrowRight, Check, Coffee, Compass, Github, Inbox, MessageCircle, MessageSquarePlus, Pin, Send, UserMinus, Users, X } from 'lucide-react'
import {
  attachmentApi,
  dmApi,
  friendApi,
  resolveAvatarUrl,
  serverApi,
  type Friend,
  type FriendRequest,
  type MessageWithAuthor,
} from '../api'
import ChatArea from '../components/ChatArea'
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
import { mergeRemoteWithRetryableLocals, reconcileConfirmedMessage } from '../messageResilience'
import {
  clearMessageDraftIfUnchanged,
  readMessageDraft,
  saveMessageDraft,
} from '../messageDrafts'
import { type SocialView, getPersistedSocialView, setPersistedSocialView } from '../socialView'
import { formatBadgeCount } from '../formatUnreadBadgeCount'
import { createReplyContentSnippet } from '../replyPreview'
import { ROUTES } from '../routes'
import {
  type FriendsFilter,
  getVisibleFriendsForFilter,
  normalizePresence,
  sortDmChannels,
  touchDmChannelActivity,
  upsertDmChannel,
} from '../friendsList'
import {
  getCachedDmMessages,
  loadDmMessagesOnce,
  setCachedDmMessages,
  type CachedDmMessage,
} from '../dmMessageCache'
import { isAppBackgrounded } from '../pushNotifications'
import {
  readDmNotificationAnchor,
  type DmNotificationAnchor,
} from '../dmNotificationNavigation'
import { createSecureId } from '../secureId'

function isDmAccessForbidden(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('No access') || msg.includes('403') || msg.includes('Forbidden')
}

function presenceLabel(status?: string | null): string {
  const normalized = normalizePresence(status)
  if (normalized === 'dnd') return 'Do Not Disturb'
  if (normalized === 'offline') return 'Offline'
  return 'Online'
}

type UiDmMessage = CachedDmMessage

function OnboardingCard({
  title,
  description,
  actions,
  actionsLayout = 'default',
}: {
  title: string
  description: string
  actions: Array<{ label: string; onClick: () => void; variant?: 'primary' | 'secondary'; icon?: ReactNode }>
  actionsLayout?: 'default' | 'equal'
}) {
  return (
    <div className="home-onboarding-card">
      <div className="home-onboarding-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className={`home-onboarding-actions ${actionsLayout === 'equal' ? 'home-onboarding-actions--equal' : ''}`}>
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
  const userId = user?.id ?? null
  const { subscribe, onReconnect } = useSocketStore()
  const {
    servers: storeServers,
    setServersLoading,
    setServers,
    setActiveServer,
    dmUnread,
    clearDmUnread,
    activeDmChannelId,
    setActiveDmChannelId,
    setDmChannelIds,
    setIncomingRequestCount,
    friends: storeFriends,
    dmChannels: storeDmChannels,
    socialDataReady,
    setFriends: setStoreFriends,
    setDmChannels: setStoreDmChannels,
    setSocialDataReady,
    setDmUnreadFromChannels,
    mobileSidebarPanel,
    setMobileSidebarPanel,
  } = useAppStore(
    useShallow((s) => ({
      servers: s.servers,
      setServersLoading: s.setServersLoading,
      setServers: s.setServers,
      setActiveServer: s.setActiveServer,
      dmUnread: s.dmUnread,
      clearDmUnread: s.clearDmUnread,
      activeDmChannelId: s.activeDmChannelId,
      setActiveDmChannelId: s.setActiveDmChannelId,
      setDmChannelIds: s.setDmChannelIds,
      setIncomingRequestCount: s.setIncomingRequestCount,
      friends: s.friends,
      dmChannels: s.dmChannels,
      socialDataReady: s.socialDataReady,
      setFriends: s.setFriends,
      setDmChannels: s.setDmChannels,
      setSocialDataReady: s.setSocialDataReady,
      setDmUnreadFromChannels: s.setDmUnreadFromChannels,
      mobileSidebarPanel: s.mobileSidebarPanel,
      setMobileSidebarPanel: s.setMobileSidebarPanel,
    }))
  )
  const navigate = useNavigate()
  const location = useLocation()
  const routeDmNotificationAnchor = readDmNotificationAnchor(location.state)
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)

  const [view, setView] = useState<SocialView>('friends')
  const isDmConversationVisible = isMessagesView && location.pathname === ROUTES.dm && view === 'dm'
  const [friendsFilter, setFriendsFilter] = useState<FriendsFilter>('online')
  const [socialBootstrapLoading, setSocialBootstrapLoading] = useState(() => !useAppStore.getState().socialDataReady)
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([])
  const [addFriendUsername, setAddFriendUsername] = useState('')
  const [addFriendMessage, setAddFriendMessage] = useState<string | null>(null)
  const [removeFriendTarget, setRemoveFriendTarget] = useState<Friend | null>(null)
  const [removingFriend, setRemovingFriend] = useState(false)
  const [openingDmPeerId, setOpeningDmPeerId] = useState<string | null>(null)
  const [updatingDmPreferenceId, setUpdatingDmPreferenceId] = useState<string | null>(null)
  const [dmContextMenu, setDmContextMenu] = useState<{ channelId: string; x: number; y: number } | null>(null)
  const [pendingDmNotificationAnchor, setPendingDmNotificationAnchor] = useState<DmNotificationAnchor | null>(null)
  const pendingDmNotificationAnchorRef = useRef<DmNotificationAnchor | null>(null)
  const isMobileSocialSidebarOpen = mobileSidebarPanel === 'social'
  const friends = storeFriends
  const dmChannels = storeDmChannels
  const showSocialBootstrapLoading = socialBootstrapLoading && !socialDataReady

  // Social paths (/social and /social/dm): restore last social tab and optional deep-linked DM.
  useEffect(() => {
    const isSocialRoute = location.pathname === ROUTES.home || location.pathname === ROUTES.dm
    if (!isSocialRoute) return
    const notificationAnchor = routeDmNotificationAnchor
    if (notificationAnchor) {
      const channel = dmChannels.find((candidate) => candidate.id === notificationAnchor.channelId)
      if (!channel) return
      pendingDmNotificationAnchorRef.current = notificationAnchor
      setPendingDmNotificationAnchor(notificationAnchor)
      setDmSearch('')
      setActiveDmChannelId(channel.id)
      setView('dm')
      setPersistedSocialView('dm')
      navigate(ROUTES.dm, { replace: true, state: {} })
      return
    }
    const openDmUserId = (location.state as { openDmUserId?: string } | null)?.openDmUserId
    if (openDmUserId && dmChannels.length > 0) {
      const channel = isUuid(openDmUserId)
        ? dmChannels.find((c) => c.peer_id === openDmUserId)
        : dmChannels.find((c) => c.peer_username === decodeURIComponent(openDmUserId))
      if (channel) {
        setActiveDmChannelId(channel.id)
        setView('dm')
        setPersistedSocialView('dm')
        clearDmUnread(channel.id)
        navigate(ROUTES.dm, { replace: true, state: {} })
      }
      return
    }
    const persistedSocialView = getPersistedSocialView()
    if (persistedSocialView === 'dm' && activeDmChannelId) {
      setView('dm')
      if (location.pathname !== ROUTES.dm) {
        navigate(ROUTES.dm, { replace: true })
      }
      return
    }
    if (location.pathname === ROUTES.dm) {
      navigate(ROUTES.home, { replace: true })
    }
    setView('friends')
  }, [location.pathname, location.state, routeDmNotificationAnchor, activeDmChannelId, dmChannels, setActiveDmChannelId, clearDmUnread, navigate])

  const voxperyServer = useMemo(
    () => storeServers.find((s) => s.invite_code === 'voxpery' || s.name === 'Voxpery') ?? null,
    [storeServers],
  )
  const [dmMessages, setDmMessages] = useState<UiDmMessage[]>([])
  const [dmUnreadDividerCount, setDmUnreadDividerCount] = useState(0)
  const [dmConversationReady, setDmConversationReady] = useState(false)
  const [dmConversationRefreshedChannelId, setDmConversationRefreshedChannelId] = useState<string | null>(null)
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
  const pendingDmMessageFingerprintsRef = useRef(new Set<string>())
  const isDmConversationVisibleRef = useRef(isDmConversationVisible)
  const dmMessagesRequestRef = useRef(0)

  useEffect(() => {
    setDmInput(readMessageDraft(userId, 'dm', activeDmChannelId))
    setDmDraftAttachments([])
  }, [activeDmChannelId, userId])

  const handleDmInputChange = useCallback((value: string) => {
    setDmInput(value)
    saveMessageDraft(userId, 'dm', activeDmChannelId, value)
  }, [activeDmChannelId, userId])
  const pushToast = useToastStore((s) => s.pushToast)
  useEffect(() => { activeDmChannelIdRef.current = activeDmChannelId }, [activeDmChannelId])
  useEffect(() => { isDmConversationVisibleRef.current = isDmConversationVisible }, [isDmConversationVisible])
  useEffect(() => {
    const anchor = pendingDmNotificationAnchorRef.current
    if (!anchor || !activeDmChannelId || anchor.channelId === activeDmChannelId) return
    pendingDmNotificationAnchorRef.current = null
    setPendingDmNotificationAnchor(null)
  }, [activeDmChannelId])

  useEffect(() => {
    if (!dmContextMenu) return
    const closeMenu = () => setDmContextMenu(null)
    const closeMenuOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', closeMenuOnKey)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', closeMenuOnKey)
    }
  }, [dmContextMenu])

  const rememberDmMessages = useCallback((channelId: string, messages: UiDmMessage[]) => {
    dmMessagesByChannelRef.current[channelId] = messages
    if (userId) setCachedDmMessages(userId, channelId, messages)
  }, [userId])

  const cachedDmMessages = useCallback((channelId: string) => {
    const local = dmMessagesByChannelRef.current[channelId]
    if (local) return local
    if (!userId) return undefined
    const shared = getCachedDmMessages(userId, channelId)
    if (shared) dmMessagesByChannelRef.current[channelId] = shared
    return shared
  }, [userId])

  const prefetchDmConversation = useCallback((channelId: string) => {
    if (!user || !userId || cachedDmMessages(channelId)) return
    void loadDmMessagesOnce(userId, channelId, () => dmApi.listMessages(channelId, token))
      .then((messages) => {
        rememberDmMessages(channelId, messages)
      })
      .catch(() => {
        // Click/open path owns user-facing error handling.
      })
  }, [cachedDmMessages, rememberDmMessages, token, user, userId])

  // Use user so web works: on web token is null, auth is via httpOnly cookie.
  const refreshServersAndFriends = useCallback(async () => {
    if (!userId) return
    const shouldBlockSocialUi = !useAppStore.getState().socialDataReady
    if (shouldBlockSocialUi) setSocialBootstrapLoading(true)

    setServersLoading(true)
    void serverApi.list(token)
      .then(setServers)
      .catch(console.error)
      .finally(() => {
        setServersLoading(false)
      })

    try {
      const [friendList, req, dms] = await Promise.all([
        friendApi.list(token),
        friendApi.requests(token),
        dmApi.listChannels(token),
      ])
      setStoreFriends(friendList)
      setIncomingRequests(req.incoming)
      setIncomingRequestCount(req.incoming.length)
      setOutgoingRequests(req.outgoing)
      setStoreDmChannels(dms)
      const pendingChannelId = pendingDmNotificationAnchorRef.current?.channelId
      setDmUnreadFromChannels(
        dms,
        pendingChannelId ? new Set([pendingChannelId]) : undefined,
      )
      setDmChannelIds(dms.map((d) => d.id))
      setSocialDataReady(true)
    } finally {
      setSocialBootstrapLoading(false)
    }
  }, [setDmChannelIds, setDmUnreadFromChannels, setIncomingRequestCount, setServers, setServersLoading, setSocialDataReady, setStoreFriends, setStoreDmChannels, token, userId])

  const refreshFriendRequests = useCallback(async () => {
    if (!userId) return
    const req = await friendApi.requests(token)
    setIncomingRequests(req.incoming)
    setIncomingRequestCount(req.incoming.length)
    setOutgoingRequests(req.outgoing)
  }, [setIncomingRequestCount, token, userId])

  useEffect(() => {
    if (!userId || !isMessagesView) return
    if (!useAppStore.getState().socialDataReady) setSocialBootstrapLoading(true)
    refreshServersAndFriends().catch(console.error)
  }, [isMessagesView, refreshServersAndFriends, userId])

  const openOfficialCommunity = useCallback(async () => {
    if (voxperyServer) {
      setActiveServer(voxperyServer.id)
      navigate(ROUTES.servers)
      return
    }
    try {
      const joined = await serverApi.join('voxpery', token)
      const list = await serverApi.list(token)
      setServers(list)
      setActiveServer(joined.id)
      navigate(ROUTES.servers)
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'Join failed',
        message: err instanceof Error ? err.message : 'Could not join server.',
      })
    }
  }, [navigate, pushToast, setActiveServer, setServers, token, voxperyServer])

  const onlineFriends = useMemo(() => getVisibleFriendsForFilter(friends, 'online'), [friends])
  const visibleFriends = useMemo(
    () => (friendsFilter === 'requests' ? [] : getVisibleFriendsForFilter(friends, friendsFilter)),
    [friends, friendsFilter],
  )
  const refreshActiveDmConversation = useCallback(async (channelId: string) => {
    if (!user || !userId) return
    const requestId = ++dmMessagesRequestRef.current
    const cached = cachedDmMessages(channelId)
    const waitsForNotificationAnchor = pendingDmNotificationAnchorRef.current?.channelId === channelId
    setDmConversationRefreshedChannelId((current) => current === channelId ? null : current)
    setDmConversationReady(!!cached && !waitsForNotificationAnchor)
    setDmMessages(cached ?? [])
    try {
      const ui = await loadDmMessagesOnce(userId, channelId, () => dmApi.listMessages(channelId, token))
      const merged = mergeRemoteWithRetryableLocals(ui, cached ?? [])
      rememberDmMessages(channelId, merged)
      if (requestId === dmMessagesRequestRef.current && activeDmChannelIdRef.current === channelId) {
        setDmMessages(merged)
        setDmConversationReady(true)
        setDmConversationRefreshedChannelId(channelId)
      }
    } catch (err) {
      if (requestId === dmMessagesRequestRef.current && activeDmChannelIdRef.current === channelId) {
        setDmConversationReady(true)
        setDmConversationRefreshedChannelId(channelId)
      }
      if (isDmAccessForbidden(err)) {
        if (activeDmChannelIdRef.current === channelId) {
          setActiveDmChannelId(null)
          setView('friends')
          setPersistedSocialView('friends')
        }
      } else {
        console.error(err)
      }
    }
  }, [cachedDmMessages, rememberDmMessages, token, user, userId, setActiveDmChannelId, setView])

  useEffect(() => {
    if (!user || !activeDmChannelId) {
      setDmUnreadDividerCount(0)
      return
    }
    if (!isDmConversationVisible) {
      setDmUnreadDividerCount(0)
      return
    }

    const unreadCount = useAppStore.getState().dmUnread[activeDmChannelId] ?? 0
    setDmUnreadDividerCount(unreadCount > 0 ? unreadCount : 0)
    const notificationAnchor = pendingDmNotificationAnchorRef.current
    if (notificationAnchor?.channelId !== activeDmChannelId) {
      clearDmUnread(activeDmChannelId)
    }
    void refreshActiveDmConversation(activeDmChannelId)
  }, [activeDmChannelId, clearDmUnread, isDmConversationVisible, refreshActiveDmConversation, user])

  useEffect(() => {
    if (!user || !activeDmChannelId) return
    const channelId = activeDmChannelId
    let cancelled = false
    const q = dmSearch.trim()
    if (!q) {
      setDmSearchResults(null)
      return
    }
    const id = window.setTimeout(() => {
      dmApi.searchMessages(channelId, q, token)
        .then((rows) => {
          if (!cancelled && activeDmChannelIdRef.current === channelId) setDmSearchResults(rows)
        })
        .catch(() => {
          if (!cancelled && activeDmChannelIdRef.current === channelId) setDmSearchResults([])
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [activeDmChannelId, dmSearch, token, user])

  useEffect(() => {
    if (!user || !activeDmChannelId) return
    const channelId = activeDmChannelId
    let cancelled = false
    dmApi
      .listPins(channelId, token)
      .then((pins) => {
        if (!cancelled && activeDmChannelIdRef.current === channelId) setDmPins(pins)
      })
      .catch((err) => {
        if (isDmAccessForbidden(err)) {
          if (!cancelled && activeDmChannelIdRef.current === channelId) {
            setActiveDmChannelId(null)
            setView('friends')
            setPersistedSocialView('friends')
          }
        }
        if (!cancelled && activeDmChannelIdRef.current === channelId) setDmPins([])
      })
    return () => {
      cancelled = true
    }
  }, [activeDmChannelId, token, user, setActiveDmChannelId, setView])

  const refreshDmPins = useCallback(() => {
    if (!activeDmChannelId) return
    const channelId = activeDmChannelId
    dmApi.listPins(channelId, token)
      .then((pins) => {
        if (activeDmChannelIdRef.current === channelId) setDmPins(pins)
      })
      .catch(() => {
        if (activeDmChannelIdRef.current === channelId) setDmPins([])
      })
  }, [activeDmChannelId, token])

  useEffect(() => {
    if (!user) return
    const unsubscribe = onReconnect(() => {
      if (isMessagesView) void refreshFriendRequests().catch(() => {})

      const currentDmChannelId = activeDmChannelIdRef.current
      if (currentDmChannelId) {
        void refreshActiveDmConversation(currentDmChannelId)
        dmApi.listPins(currentDmChannelId, token)
          .then((pins) => {
            if (activeDmChannelIdRef.current === currentDmChannelId) setDmPins(pins)
          })
          .catch(() => {
            if (activeDmChannelIdRef.current === currentDmChannelId) setDmPins([])
          })
      }
    })
    return () => unsubscribe()
  }, [isMessagesView, onReconnect, refreshActiveDmConversation, refreshFriendRequests, token, user])

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
          rememberDmMessages(activeDmChannelId, next)
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
  }, [token, user, pushToast, activeDmChannelId, rememberDmMessages])

  /* When switching to DM: lock window scroll and blur so nothing triggers page shift */
  useEffect(() => {
    if (view !== 'dm') return
    window.scrollTo(0, 0)
      ; (document.activeElement as HTMLElement | null)?.blur()
  }, [view])

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
          rememberDmMessages(channelId, next)
          return next
        }
        const isFromMe = incoming.author?.user_id === user?.id
        const sendingIdx = prev.findIndex((m) => m.clientStatus === 'sending' && m.author?.user_id === user?.id)
        if (isFromMe && sendingIdx >= 0) {
          const next = [...prev]
          next[sendingIdx] = incoming
          rememberDmMessages(channelId, next)
          return next
        }
        const next = [...prev, incoming]
        rememberDmMessages(channelId, next)
        return next
      })
      const notificationAnchor = pendingDmNotificationAnchorRef.current
      const isWaitingForNotificationAnchor = notificationAnchor?.channelId === channelId
      if (isDmConversationVisibleRef.current && !isAppBackgrounded() && !isWaitingForNotificationAnchor) {
        clearDmUnread(channelId)
        void dmApi.markRead(channelId, token).catch(() => {
          // Best-effort read sync; the next conversation refresh will reconcile.
        })
      }
    })
    return () => unsub()
  }, [clearDmUnread, rememberDmMessages, subscribe, token, user?.id])

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
    if (!userId || !isMessagesView) return
    const unsub = subscribe((evt: unknown) => {
      const e = evt as { type?: string; data?: { user_id?: string } }
      if (e?.type !== 'FriendUpdate') return
      const uid = e.data?.user_id
      if (uid !== userId) return
      refreshFriendRequests().catch(() => { })
    })
    return () => unsub()
  }, [isMessagesView, refreshFriendRequests, subscribe, userId])

  const openMessageForFriend = useCallback(async (friendId: string) => {
    if (!user || openingDmPeerId) return
    setOpeningDmPeerId(friendId)
    try {
      const channel = await dmApi.getOrCreateChannel(friendId, token)
      const nextChannels = upsertDmChannel(useAppStore.getState().dmChannels, channel)

      setStoreDmChannels(nextChannels)
      setDmChannelIds(nextChannels.map((dmChannel) => dmChannel.id))
      setActiveDmChannelId(channel.id)
      clearDmUnread(channel.id)
      setView('dm')
      setPersistedSocialView('dm')
      navigate(ROUTES.dm)
    } catch (err) {
      pushToast({
        level: 'error',
        title: 'DM failed',
        message: err instanceof Error ? err.message : 'Could not open direct message.',
      })
    } finally {
      setOpeningDmPeerId(null)
    }
  }, [
    clearDmUnread,
    navigate,
    openingDmPeerId,
    pushToast,
    setActiveDmChannelId,
    setDmChannelIds,
    setStoreDmChannels,
    token,
    user,
  ])

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
    const [friendList] = await Promise.all([
      friendApi.list(token),
      refreshFriendRequests(),
    ])
    setStoreFriends(friendList)
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

  const handleToggleDmPinned = useCallback(async (channelId: string, pinned: boolean) => {
    if (!user || updatingDmPreferenceId) return
    const previousChannels = useAppStore.getState().dmChannels
    const nextChannels = sortDmChannels(
      previousChannels.map((channel) =>
        channel.id === channelId
          ? { ...channel, is_pinned: pinned, pinned_at: pinned ? new Date().toISOString() : null }
          : channel,
      ),
    )
    setUpdatingDmPreferenceId(channelId)
    setStoreDmChannels(nextChannels)
    try {
      await dmApi.updateChannelPreferences(channelId, pinned, token)
    } catch (err) {
      setStoreDmChannels(previousChannels)
      pushToast({
        level: 'error',
        title: pinned ? 'Pin failed' : 'Unpin failed',
        message: err instanceof Error ? err.message : 'Could not update this conversation.',
      })
    } finally {
      setUpdatingDmPreferenceId(null)
    }
  }, [pushToast, setStoreDmChannels, token, updatingDmPreferenceId, user])

  const handleHideDmChannel = useCallback(async (channelId: string) => {
    const previousChannels = useAppStore.getState().dmChannels
    const nextChannels = previousChannels.filter((channel) => channel.id !== channelId)
    setDmContextMenu(null)
    setStoreDmChannels(nextChannels)
    setDmChannelIds(nextChannels.map((channel) => channel.id))
    if (activeDmChannelId === channelId) {
      setView('friends')
      setActiveDmChannelId(null)
      setPersistedSocialView('friends')
      navigate(ROUTES.home)
    }
    try {
      await dmApi.hideChannel(channelId, token)
    } catch (err) {
      setStoreDmChannels(previousChannels)
      setDmChannelIds(previousChannels.map((channel) => channel.id))
      pushToast({
        level: 'error',
        title: 'DM hide failed',
        message: err instanceof Error ? err.message : 'Could not hide this conversation.',
      })
    }
  }, [activeDmChannelId, navigate, pushToast, setActiveDmChannelId, setDmChannelIds, setStoreDmChannels, token])

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
      setDmDraftAttachments((prev) => markDraftAttachmentsFailed(prev, pendingIds, 'Upload failed'))
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
      setDmDraftAttachments((prev) => markDraftAttachmentsFailed(prev, [localId], 'Upload failed'))
      pushToast({
        level: 'error',
        title: 'Upload failed',
        message: errorMessage,
      })
    }
  }, [dmDraftAttachments, token, pushToast])

  const handleSendDm = async (_e?: FormEvent, forceContent?: string) => {
    if (!user || !activeDmChannelId) return
    const channelId = activeDmChannelId
    if (hasPendingDraftAttachments(dmDraftAttachments)) {
      pushToast({
        level: 'error',
        title: 'Attachment still pending',
        message: 'Finish uploading attachments or retry failed ones before sending.',
      })
      return
    }
    const isForcedContent = typeof forceContent === 'string'
    const inputValue = isForcedContent ? forceContent : dmInput
    const bodyText = inputValue.trim()
    const attachmentsToSend = getUploadedDraftAttachments(dmDraftAttachments)
    if (!bodyText && attachmentsToSend.length === 0) return
    const content = replyingToDm
      ? `> @${replyingToDm.username}: ${replyingToDm.contentSnippet}\n\n${bodyText}`
      : bodyText
    const sendFingerprint = `${channelId}\n${content}\n${JSON.stringify(attachmentsToSend)}`
    if (pendingDmMessageFingerprintsRef.current.has(sendFingerprint)) return
    pendingDmMessageFingerprintsRef.current.add(sendFingerprint)
    setReplyingToDm(null)
    if (!isForcedContent) setDmInput('')
    setDmDraftAttachments([])
    const clientId = createSecureId()
    const optimisticId = `local-${clientId}`
    const optimistic: UiDmMessage = {
      id: optimisticId,
      channel_id: channelId,
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
      rememberDmMessages(channelId, next)
      return next
    })
    try {
      const msg = await dmApi.sendMessage(channelId, content, attachmentsToSend, token, clientId)
      clearDmUnread(channelId)
      setStoreDmChannels(
        touchDmChannelActivity(useAppStore.getState().dmChannels, channelId, msg.created_at),
      )
      const applySentDm = (current: UiDmMessage[]) => {
        return reconcileConfirmedMessage(current, clientId, msg)
      }
      if (activeDmChannelIdRef.current === channelId) {
        setDmMessages((prev) => {
          const next = applySentDm(prev)
          rememberDmMessages(channelId, next)
          return next
        })
      } else {
        rememberDmMessages(channelId, applySentDm(dmMessagesByChannelRef.current[channelId] ?? []))
      }
      if (!isForcedContent) {
        clearMessageDraftIfUnchanged(userId, 'dm', channelId, inputValue)
      }
    } catch (err) {
      const applyFailedDm = (current: UiDmMessage[]) =>
        current.map((m) =>
          m.clientId === clientId
            ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Send failed' }
            : m
        )
      if (activeDmChannelIdRef.current === channelId) {
        setDmMessages((prev) => {
          const next = applyFailedDm(prev)
          rememberDmMessages(channelId, next)
          return next
        })
      } else {
        rememberDmMessages(channelId, applyFailedDm(dmMessagesByChannelRef.current[channelId] ?? []))
      }
      if (!isForcedContent && activeDmChannelIdRef.current === channelId) {
        setDmInput((current) => current || inputValue)
      }
    } finally {
      pendingDmMessageFingerprintsRef.current.delete(sendFingerprint)
    }
  }

  const handleRetryDmMessage = useCallback(
    async (clientId: string) => {
      if (!user || !activeDmChannelId) return
      const channelId = activeDmChannelId
      const target = dmMessages.find((m) => m.clientId === clientId)
      if (!target || target.clientStatus !== 'failed') return
      setDmMessages((prev) => {
        const next = prev.map((m) =>
          m.clientId === clientId ? { ...m, clientStatus: 'sending' as const, clientError: undefined } : m
        )
        rememberDmMessages(channelId, next)
        return next
      })
      try {
        const msg = await dmApi.sendMessage(
          channelId,
          target.content,
          target.attachments ?? [],
          token,
          clientId,
        )
        clearDmUnread(channelId)
        const applyRetriedDm = (current: UiDmMessage[]) => {
          if (current.some((m) => m.id === msg.id)) {
            return current.filter((m) => m.clientId !== clientId)
          }
          return current.map((m) => (m.clientId === clientId ? msg : m))
        }
        if (activeDmChannelIdRef.current === channelId) {
          setDmMessages((prev) => {
            const next = applyRetriedDm(prev)
            rememberDmMessages(channelId, next)
            return next
          })
        } else {
          rememberDmMessages(channelId, applyRetriedDm(dmMessagesByChannelRef.current[channelId] ?? []))
        }
      } catch (err) {
        const applyFailedRetry = (current: UiDmMessage[]) =>
          current.map((m) =>
            m.clientId === clientId
              ? { ...m, clientStatus: 'failed' as const, clientError: err instanceof Error ? err.message : 'Retry failed' }
              : m
          )
        if (activeDmChannelIdRef.current === channelId) {
          setDmMessages((prev) => {
            const next = applyFailedRetry(prev)
            rememberDmMessages(channelId, next)
            return next
          })
        } else {
          rememberDmMessages(channelId, applyFailedRetry(dmMessagesByChannelRef.current[channelId] ?? []))
        }
      }
    },
    [token, activeDmChannelId, dmMessages, user, clearDmUnread, rememberDmMessages]
  )

  const displayedDmMessages = dmSearch.trim() ? (dmSearchResults ?? []) : dmMessages

  const notificationJumpMessageId = useMemo(() => {
    const anchor = pendingDmNotificationAnchor ?? routeDmNotificationAnchor
    if (!anchor || anchor.channelId !== activeDmChannelId) return null
    if (dmConversationRefreshedChannelId !== anchor.channelId || dmSearch.trim()) return null
    if (anchor.messageId && dmMessages.some((message) => message.id === anchor.messageId)) {
      return anchor.messageId
    }
    return dmMessages.at(-1)?.id ?? null
  }, [activeDmChannelId, dmConversationRefreshedChannelId, dmMessages, dmSearch, pendingDmNotificationAnchor, routeDmNotificationAnchor])

  const isNotificationHistoryPending =
    pendingDmNotificationAnchor?.channelId === activeDmChannelId
    && dmConversationRefreshedChannelId !== activeDmChannelId

  const handleDmNotificationAnchorVisible = useCallback(() => {
    const anchor = pendingDmNotificationAnchorRef.current
    if (!anchor || anchor.channelId !== activeDmChannelIdRef.current) return
    pendingDmNotificationAnchorRef.current = null
    setPendingDmNotificationAnchor(null)
    clearDmUnread(anchor.channelId)
    void dmApi.markRead(anchor.channelId, token).catch(() => {
      // Best-effort read sync; the next conversation refresh will reconcile.
    })
  }, [clearDmUnread, token])

  const saveDmEdit = useCallback(async () => {
    if (!user || !editingDmMessageId || !editingDmContent.trim()) return
    try {
      const updated = await dmApi.editMessage(editingDmMessageId, editingDmContent.trim(), token)
      setDmMessages((prev) => {
        const next = prev.map((m) => (m.id === updated.id ? updated : m))
        if (activeDmChannelId) rememberDmMessages(activeDmChannelId, next)
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
  }, [user, token, editingDmMessageId, editingDmContent, activeDmChannelId, dmSearch, rememberDmMessages])

  const removeDmMessage = useCallback(
    async (messageId: string) => {
      if (!user) return
      const isLocalOptimistic = messageId.startsWith('local-')
      if (isLocalOptimistic) {
        setDmMessages((prev) => {
          const next = prev.filter((m) => m.id !== messageId)
          if (activeDmChannelId) rememberDmMessages(activeDmChannelId, next)
          return next
        })
        setDeleteDmConfirmMessageId(null)
        return
      }
      try {
        await dmApi.deleteMessage(messageId, token)
        setDmMessages((prev) => {
          const next = prev.filter((m) => m.id !== messageId)
          if (activeDmChannelId) rememberDmMessages(activeDmChannelId, next)
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
    [user, token, activeDmChannelId, dmSearch, rememberDmMessages]
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
            if (location.pathname !== ROUTES.home) navigate(ROUTES.home)
            setMobileSidebarPanel('none')
          }}
        >
          <Users size={14} />
          <span className="social-nav-item-label">Friends</span>
          {incomingRequests.length > 0 && <span className="notif-dot" />}
        </button>
        <div className="social-sidebar-divider" />
        <div className="social-sidebar-title">Direct Messages</div>
        {showSocialBootstrapLoading ? (
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
          dmChannels.map((channel, index) => (
            <Fragment key={channel.id}>
              {channel.is_pinned && (index === 0 || !dmChannels[index - 1]?.is_pinned) && (
                <div className="social-dm-group-label">Pinned</div>
              )}
              {!channel.is_pinned && index > 0 && dmChannels[index - 1]?.is_pinned && (
                <div className="social-dm-group-label">Recent</div>
              )}
            <div
              className={`social-dm-item ${view === 'dm' && activeDmChannelId === channel.id ? 'active' : ''}`}
              onPointerEnter={() => prefetchDmConversation(channel.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                const rect = event.currentTarget.getBoundingClientRect()
                const menuWidth = 196
                const menuHeight = 82
                const requestedX = event.clientX || rect.right
                const requestedY = event.clientY || rect.bottom
                setDmContextMenu({
                  channelId: channel.id,
                  x: Math.min(Math.max(8, requestedX), Math.max(8, window.innerWidth - menuWidth - 8)),
                  y: Math.min(Math.max(8, requestedY), Math.max(8, window.innerHeight - menuHeight - 8)),
                })
              }}
            >
              <button
                type="button"
                className="social-dm-open"
                onFocus={() => prefetchDmConversation(channel.id)}
                onClick={(e) => {
                  e.currentTarget.blur()
                  const cached = cachedDmMessages(channel.id)
                  setDmMessages(cached ?? [])
                  setDmConversationReady(!!cached)
                  setView('dm')
                  setActiveDmChannelId(channel.id)
                  setPersistedSocialView('dm')
                  clearDmUnread(channel.id)
                  if (location.pathname !== ROUTES.dm) navigate(ROUTES.dm)
                  setMobileSidebarPanel('none')
                }}
                aria-label={`Open DM with ${channel.peer_username}`}
              >
                <div className={`home-member-avatar avatar-status-${(channel.peer_status ?? 'offline') as StatusValue}`}>
                  {channel.peer_avatar_url ? (
                    <img src={resolveAvatarUrl(channel.peer_avatar_url) ?? ''} alt="" />
                  ) : (
                    channel.peer_username.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="home-member-meta">
                  <div>{channel.peer_username}</div>
                </div>
              </button>
              <div className="social-dm-actions">
                {(dmUnread[channel.id] ?? 0) > 0 && <span className="social-dm-unread">{formatBadgeCount(dmUnread[channel.id] ?? 0)}</span>}
                <button
                  type="button"
                  className="home-member-action social-dm-close"
                  title="Hide conversation"
                  aria-label={`Hide DM with ${channel.peer_username}`}
                  onClick={() => void handleHideDmChannel(channel.id)}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            </Fragment>
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
                  <span className="home-chip-label">Online</span>
                </button>
                <button
                  type="button"
                  className={`home-chip ${friendsFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setFriendsFilter('all')}
                >
                  <Users size={14} />
                  <span className="home-chip-label">All</span>
                </button>
                <button
                  type="button"
                  className={`home-chip ${friendsFilter === 'requests' ? 'active' : ''}`}
                  onClick={() => setFriendsFilter('requests')}
                >
                  <MessageSquarePlus size={14} />
                  <span className="home-chip-label">Requests</span>
                  {incomingRequests.length > 0 && (
                    <span className="home-chip-badge">{formatBadgeCount(incomingRequests.length)}</span>
                  )}
                </button>
              </div>
              {friendsFilter === 'requests' ? (
                <div className="home-friends-scroll home-friends-scroll--requests">
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
                      <span className="home-list-count">{formatBadgeCount(incomingRequests.length)}</span>
                    </div>
                    {incomingRequests.length === 0 ? (
                      <div className="home-empty-row home-empty-muted">No incoming requests.</div>
                    ) : (
                      incomingRequests.map((r) => (
                        <div key={r.id} className="home-request-row">
                          <span>{r.requester_username}</span>
                          <div className="home-request-actions">
                            <button
                              type="button"
                              className="home-request-btn accept"
                              aria-label={`Accept friend request from ${r.requester_username}`}
                              onClick={() => acceptRequest(r.id)}
                            >
                              <Check size={14} />
                            </button>
                            <button
                              type="button"
                              className="home-request-btn reject"
                              aria-label={`Reject friend request from ${r.requester_username}`}
                              onClick={() => rejectRequest(r.id)}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                    <div className="home-list-title home-list-title-with-icon home-list-title-secondary">
                      <Send size={16} />
                      <span>Outgoing</span>
                      <span className="home-list-count">{formatBadgeCount(outgoingRequests.length)}</span>
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
                </div>
              ) : (
                <div className="home-friends-scroll">
                  <div className="home-list-group">
                    <div className="home-list-title">
                      {friendsFilter === 'online'
                        ? `Online Friends — ${onlineFriends.length}`
                        : `All Friends — ${friends.length}`}
                    </div>
                    {showSocialBootstrapLoading ? (
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
                            className={`home-member-row is-clickable ${openingDmPeerId === friend.id ? 'is-loading' : ''}`}
                            aria-disabled={openingDmPeerId === friend.id}
                          >
                            <button
                              type="button"
                              className="home-member-main"
                              aria-label={`Message ${friend.username}`}
                              disabled={openingDmPeerId === friend.id}
                              onClick={() => void openMessageForFriend(friend.id)}
                            >
                              <div className={`home-member-avatar avatar-status-${['online', 'dnd', 'offline'].includes((friend.status ?? '').toLowerCase()) ? (friend.status ?? 'offline').toLowerCase() : 'offline'}`}>
                                {friend.avatar_url ? (
                                  <img src={resolveAvatarUrl(friend.avatar_url) ?? ''} alt="" />
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
                            </button>
                            <div className="home-member-actions">
                              <button
                                type="button"
                                className="home-member-action home-member-action--message"
                                title="Send message"
                                aria-label={`Open DM with ${friend.username}`}
                                disabled={openingDmPeerId === friend.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void openMessageForFriend(friend.id)
                                }}
                              >
                                <MessageCircle size={15} />
                              </button>
                              <button
                                type="button"
                                className="home-member-action danger"
                                title="Remove friend"
                                aria-label={`Remove ${friend.username} as friend`}
                                disabled={openingDmPeerId === friend.id}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setRemoveFriendTarget(friend)
                                }}
                              >
                                <UserMinus size={15} />
                              </button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {view === 'dm' && (() => {
            const dmChannel = activeDmChannelId ? storeDmChannels.find((c) => c.id === activeDmChannelId) : null
            if (showSocialBootstrapLoading) {
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
                loading={
                  !dmSearch.trim()
                  && (!dmConversationReady || isNotificationHistoryPending)
                  && (displayedDmMessages.length === 0 || isNotificationHistoryPending)
                }
                unreadDividerCount={dmUnreadDividerCount}
                draftAttachments={dmDraftAttachments}
                messageInput={dmInput}
                onPickAttachments={handleDmAttachmentPick}
                onRemoveAttachment={(index) => setDmDraftAttachments((prev) => prev.filter((_, i) => i !== index))}
                onRetryAttachment={handleRetryDmAttachment}
                onMessageInputChange={handleDmInputChange}
                onSendMessage={handleSendDm}
                onRetryMessage={handleRetryDmMessage}
                onDeleteMessage={setDeleteDmConfirmMessageId}
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
                  const snippet = createReplyContentSnippet(msg.content)
                  setReplyingToDm({ id: msg.id, username, contentSnippet: snippet })
                }}
                isViewActive={isMessagesView}
                searchQuery={dmSearch}
                onSearchChange={setDmSearch}
                pinnedMessages={dmPins}
                onPinMessage={handlePinDmMessage}
                onUnpinMessage={handleUnpinDmMessage}
                onToggleReaction={handleToggleDmReaction}
                emptyStateTitle={`Start your conversation with ${dmChannel.peer_username}`}
                emptyStateDescription="This is the beginning of your direct message history."
                jumpToMessageId={notificationJumpMessageId}
                onJumpToMessageHandled={handleDmNotificationAnchorVisible}
              />
            )
          })()}
        </div>
      </section>

      {dmContextMenu && (() => {
        const channel = dmChannels.find((candidate) => candidate.id === dmContextMenu.channelId)
        if (!channel) return null
        return createPortal(
          <div
            className="server-context-menu social-dm-context-menu"
            role="menu"
            aria-label={`Conversation actions for ${channel.peer_username}`}
            style={{ left: dmContextMenu.x, top: dmContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="server-context-menu-item"
              role="menuitem"
              disabled={updatingDmPreferenceId === channel.id}
              onClick={() => {
                setDmContextMenu(null)
                void handleToggleDmPinned(channel.id, !channel.is_pinned)
              }}
            >
              <Pin size={14} />
              {channel.is_pinned ? 'Unpin Conversation' : 'Pin Conversation'}
            </button>
            <button
              type="button"
              className="server-context-menu-item danger"
              role="menuitem"
              onClick={() => void handleHideDmChannel(channel.id)}
            >
              <X size={14} />
              Close DM
            </button>
          </div>,
          document.body,
        )
      })()}

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

