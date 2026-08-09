import { useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import type { ServerSettingsTab } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import UnifiedSidebar from '../components/UnifiedSidebar'
import HomePage from './HomePage'
import AppLayout from './AppLayout'
import { friendApi } from '../api'
import { shouldShowPushNotification, showPushNotification } from '../pushNotifications'
import { playMessageNotificationSound, shouldPlayNotificationSound } from '../notificationSound'
import { ROUTES } from '../routes'

const ACTIVE_SERVER_STORAGE_KEY = 'voxpery-active-server-id'

function tryGetStoredServerId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_SERVER_STORAGE_KEY)
  } catch {
    return null
  }
}

export default function UnifiedLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, token } = useAuthStore()
  const userId = user?.id ?? null
  const userStatus = user?.status
  const { onReconnect, subscribe } = useSocketStore()
  const {
    activeServerId,
    setActiveServer,
    setShowCreateServer,
    setShowJoinServer,
    setOpenServerSettingsForServerId,
    setOpenServerSettingsForServerTab,
    dmUnread,
    servers,
    incomingRequestCount,
    setIncomingRequestCount,
    resetIncomingRequestCount,
  } = useAppStore(
    useShallow((s) => ({
      activeServerId: s.activeServerId,
      setActiveServer: s.setActiveServer,
      setShowCreateServer: s.setShowCreateServer,
      setShowJoinServer: s.setShowJoinServer,
      setOpenServerSettingsForServerId: s.setOpenServerSettingsForServerId,
      setOpenServerSettingsForServerTab: s.setOpenServerSettingsForServerTab,
      dmUnread: s.dmUnread,
      servers: s.servers,
      incomingRequestCount: s.incomingRequestCount,
      setIncomingRequestCount: s.setIncomingRequestCount,
      resetIncomingRequestCount: s.resetIncomingRequestCount,
    }))
  )

  const isFriendsOrDm = location.pathname === ROUTES.home || location.pathname === ROUTES.dm
  const isServerView = location.pathname === ROUTES.servers || location.pathname.startsWith(`${ROUTES.servers}/`)

  // When on /servers with no active server, set first server (or restore from sessionStorage)
  useEffect(() => {
    if (!isServerView) return
    if (activeServerId) {
      try { sessionStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, activeServerId) } catch { /* ignore */ }
      return
    }
    const restored = tryGetStoredServerId()
    if (restored && servers.some((s) => s.id === restored)) {
      setActiveServer(restored)
      return
    }
    const first = servers.find((s) => s.invite_code === 'voxpery' || s.name === 'Voxpery') ?? servers[0]
    if (first) {
      setActiveServer(first.id)
    }
  }, [isServerView, activeServerId, servers, setActiveServer, navigate])

  const totalDmUnread = useMemo(
    () => Object.values(dmUnread).reduce((acc, n) => acc + n, 0),
    [dmUnread]
  )
  const previousIncomingCountRef = useRef(incomingRequestCount)

  useEffect(() => {
    if (!userId) {
      resetIncomingRequestCount()
      previousIncomingCountRef.current = 0
      return
    }
    let cancelled = false
    let inFlight: Promise<void> | null = null
    let refreshQueued = false
    let lastRefreshAt = 0
    function refresh(force = false): Promise<void> {
      if (!force && Date.now() - lastRefreshAt < 30_000) return Promise.resolve()
      if (inFlight) {
        if (force) refreshQueued = true
        return inFlight
      }
      inFlight = friendApi.requests(token).then((req) => {
        if (cancelled) return
        lastRefreshAt = Date.now()
        setIncomingRequestCount(req.incoming.length)
        if (req.incoming.length > previousIncomingCountRef.current) {
          if (shouldPlayNotificationSound(userStatus)) {
            playMessageNotificationSound()
          }
          if (shouldShowPushNotification(userStatus)) {
            showPushNotification({
              title: 'New friend request',
              body: req.incoming.length === 1
                ? 'Someone wants to connect with you on Voxpery.'
                : `You now have ${req.incoming.length} incoming friend requests.`,
              tag: 'friends:incoming',
            })
          }
        }
        previousIncomingCountRef.current = req.incoming.length
      }).catch(() => {
        // Keep the latest count on transient network failures.
      }).finally(() => {
        inFlight = null
        if (refreshQueued && !cancelled) {
          refreshQueued = false
          void refresh(true)
        }
      })
      return inFlight
    }
    void refresh(true)
    const unsubscribeEvents = subscribe((event: unknown) => {
      const message = event as { type?: string; data?: { user_id?: string } }
      if (message.type !== 'FriendUpdate') return
      if (message.data?.user_id && message.data.user_id !== userId) return
      void refresh(true)
    })
    const unsubscribeReconnect = onReconnect(() => {
      void refresh(true)
    })
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      unsubscribeEvents()
      unsubscribeReconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onReconnect, resetIncomingRequestCount, setIncomingRequestCount, subscribe, token, userId, userStatus])

  const handleOpenServerSettings = (id: string, initialTab: ServerSettingsTab = 'overview') => {
    setOpenServerSettingsForServerTab(initialTab)
    setOpenServerSettingsForServerId(id)
    setActiveServer(id)
    navigate(ROUTES.servers)
  }

  return (
    <div className="unified-layout">
      <UnifiedSidebar
        onCreateServer={() => setShowCreateServer(true)}
        onJoinServer={() => setShowJoinServer(true)}
        onOpenServerSettings={handleOpenServerSettings}
        totalDmUnread={totalDmUnread}
        incomingRequestCount={incomingRequestCount}
      />
      <div
        className="unified-content unified-content-friends"
        style={{ display: isFriendsOrDm ? undefined : 'none' }}
        aria-hidden={!isFriendsOrDm}
      >
        <HomePage isMessagesView={isFriendsOrDm} />
      </div>
      <div
        className="unified-content unified-content-server"
        style={{ display: isServerView ? undefined : 'none' }}
        aria-hidden={!isServerView}
      >
        <AppLayout skipServerSidebar isViewActive={isServerView} />
      </div>
    </div>
  )
}
