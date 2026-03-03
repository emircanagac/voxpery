import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import UnifiedSidebar from '../components/UnifiedSidebar'
import HomePage from './HomePage'
import AppLayout from './AppLayout'
import { friendApi } from '../api'

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
  const {
    activeServerId,
    setActiveServer,
    setShowCreateServer,
    setShowJoinServer,
    setOpenServerSettingsForServerId,
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
      dmUnread: s.dmUnread,
      servers: s.servers,
      incomingRequestCount: s.incomingRequestCount,
      setIncomingRequestCount: s.setIncomingRequestCount,
      resetIncomingRequestCount: s.resetIncomingRequestCount,
    }))
  )

  const isFriendsOrDm =
    location.pathname === '/app/friends' ||
    location.pathname === '/app' ||
    location.pathname === '/app/dm' ||
    location.pathname.startsWith('/app/dm/')
  const isServerView = location.pathname === '/app/servers'

  // When on /app/servers with no active server, set first server (or restore from sessionStorage)
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
    if (first) setActiveServer(first.id)
    else navigate('/app/friends', { replace: true })
  }, [isServerView, activeServerId, servers, setActiveServer, navigate])

  // When leaving servers view, clear server from store (optional: keep for "last server" next time)
  useEffect(() => {
    if (isFriendsOrDm) setActiveServer(null)
  }, [isFriendsOrDm, setActiveServer])

  const totalDmUnread = useMemo(
    () => Object.values(dmUnread).reduce((acc, n) => acc + n, 0),
    [dmUnread]
  )

  useEffect(() => {
    if (!user) {
      resetIncomingRequestCount()
      return
    }
    let cancelled = false
    const refresh = async () => {
      try {
        const req = await friendApi.requests(token)
        if (!cancelled) setIncomingRequestCount(req.incoming.length)
      } catch {
        if (!cancelled) resetIncomingRequestCount()
      }
    }
    void refresh()
    const id = window.setInterval(() => {
      void refresh()
    }, 6000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [resetIncomingRequestCount, setIncomingRequestCount, token, user])

  const handleOpenServerSettings = (id: string) => {
    setOpenServerSettingsForServerId(id)
    setActiveServer(id)
    navigate('/app/servers')
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
