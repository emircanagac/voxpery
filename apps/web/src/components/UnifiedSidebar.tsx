import { useEffect, useState, type MouseEvent } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import type { ServerSettingsTab } from '../stores/app'
import ServerSidebar from './ServerSidebar'
import { formatBadgeCount } from '../formatUnreadBadgeCount'
import { ROUTES } from '../routes'
import { getPersistedSocialView } from '../socialView'

interface UnifiedSidebarProps {
  onCreateServer: () => void
  onJoinServer: () => void
  onOpenServerSettings?: (serverId: string, initialTab?: ServerSettingsTab) => void
  totalDmUnread?: number
  incomingRequestCount?: number
}

type MobilePanelTarget = 'social' | 'channels'

export default function UnifiedSidebar({
  onCreateServer,
  onJoinServer,
  onOpenServerSettings,
  totalDmUnread = 0,
  incomingRequestCount = 0,
}: UnifiedSidebarProps) {
  const MOBILE_PANEL_TRANSITION_MS = 250
  const navigate = useNavigate()
  const location = useLocation()
  const { activeServerId, activeDmChannelId, mobileSidebarPanel, setActiveServer, setMobileSidebarPanel } = useAppStore(
    useShallow((s) => ({
      activeServerId: s.activeServerId,
      activeDmChannelId: s.activeDmChannelId,
      mobileSidebarPanel: s.mobileSidebarPanel,
      setActiveServer: s.setActiveServer,
      setMobileSidebarPanel: s.setMobileSidebarPanel,
    }))
  )
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 700px)').matches : false
  )
  const [pendingMobilePanel, setPendingMobilePanel] = useState<MobilePanelTarget | null>(null)
  const [pendingNavigationTimeout, setPendingNavigationTimeout] = useState<number | null>(null)
  const isServerRoute = location.pathname.startsWith(ROUTES.servers)
  const displayActiveServerId = isServerRoute ? activeServerId : null
  const isSocialRoute = location.pathname === ROUTES.home || location.pathname === ROUTES.dm
  const totalSocialUnread = totalDmUnread + incomingRequestCount
  const hasMessagesNotify = totalSocialUnread > 0
  const savedSocialView = getPersistedSocialView()
  const socialHref = savedSocialView === 'dm' && activeDmChannelId ? ROUTES.dm : ROUTES.home

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const media = window.matchMedia('(max-width: 700px)')
    const updateViewport = () => setIsMobileViewport(media.matches)

    updateViewport()
    media.addEventListener('change', updateViewport)
    return () => media.removeEventListener('change', updateViewport)
  }, [])

  useEffect(() => {
    return () => {
      if (pendingNavigationTimeout != null) {
        window.clearTimeout(pendingNavigationTimeout)
      }
    }
  }, [pendingNavigationTimeout])

  useEffect(() => {
    if (!isMobileViewport || !pendingMobilePanel) return undefined

    const routeMatchesPendingPanel =
      (pendingMobilePanel === 'social' && isSocialRoute) ||
      (pendingMobilePanel === 'channels' && isServerRoute)

    if (!routeMatchesPendingPanel) return undefined

    let frameA = 0
    let frameB = 0

    frameA = window.requestAnimationFrame(() => {
      frameB = window.requestAnimationFrame(() => {
        setMobileSidebarPanel(pendingMobilePanel)
        setPendingMobilePanel(null)
      })
    })

    return () => {
      window.cancelAnimationFrame(frameA)
      window.cancelAnimationFrame(frameB)
    }
  }, [isMobileViewport, isServerRoute, isSocialRoute, pendingMobilePanel, setMobileSidebarPanel])

  const handleSelectServer = (serverId: string) => {
    if (isMobileViewport) {
      const isSameServerPanelOpen =
        isServerRoute && activeServerId === serverId && mobileSidebarPanel === 'channels'
      const isSwitchingServersWithOpenPanel =
        isServerRoute && activeServerId !== null && activeServerId !== serverId && mobileSidebarPanel === 'channels'

      if (isSameServerPanelOpen) {
        setMobileSidebarPanel('none')
        setPendingMobilePanel(null)
        return
      }

      if (isSwitchingServersWithOpenPanel) {
        if (pendingNavigationTimeout != null) {
          window.clearTimeout(pendingNavigationTimeout)
        }

        setMobileSidebarPanel('none')
        setPendingMobilePanel(null)

        const timeoutId = window.setTimeout(() => {
          setActiveServer(serverId)
          setPendingMobilePanel('channels')
          setPendingNavigationTimeout(null)
        }, MOBILE_PANEL_TRANSITION_MS)

        setPendingNavigationTimeout(timeoutId)
        return
      }

      if (!isServerRoute) {
        if (pendingNavigationTimeout != null) {
          window.clearTimeout(pendingNavigationTimeout)
        }

        setMobileSidebarPanel('none')
        setPendingMobilePanel('channels')
        setActiveServer(serverId)

        const timeoutId = window.setTimeout(() => {
          navigate(ROUTES.servers)
          setPendingNavigationTimeout(null)
        }, mobileSidebarPanel !== 'none' ? MOBILE_PANEL_TRANSITION_MS : 0)

        setPendingNavigationTimeout(timeoutId)
        return
      }

      setPendingMobilePanel(null)
      setMobileSidebarPanel('channels')
    }

    setActiveServer(serverId)

    if (!isServerRoute) {
      navigate(ROUTES.servers)
    }
  }

  const handleSelectSocial = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isMobileViewport) {
      const isSameSocialPanelOpen = isSocialRoute && mobileSidebarPanel === 'social'

      if (isSameSocialPanelOpen) {
        event.preventDefault()
        setMobileSidebarPanel('none')
        setPendingMobilePanel(null)
        return
      }

      if (!isSocialRoute) {
        event.preventDefault()

        if (pendingNavigationTimeout != null) {
          window.clearTimeout(pendingNavigationTimeout)
        }

        setMobileSidebarPanel('none')
        setPendingMobilePanel('social')

        const timeoutId = window.setTimeout(() => {
          navigate(socialHref)
          setPendingNavigationTimeout(null)
        }, mobileSidebarPanel !== 'none' ? MOBILE_PANEL_TRANSITION_MS : 0)

        setPendingNavigationTimeout(timeoutId)
        return
      }

      setPendingMobilePanel(null)
      setMobileSidebarPanel('social')
    }
  }

  return (
    <div className="unified-sidebar">
      <div className="unified-sidebar-dm-section">
        <NavLink
          to={socialHref}
          onClick={handleSelectSocial}
          className={() =>
            `unified-dm-entry ${isSocialRoute ? 'active' : ''} ${hasMessagesNotify ? 'has-notify' : ''}`
          }
          title="Friends, requests, and direct messages"
          aria-label="Social"
        >
          <MessageCircle size={22} />
          {totalSocialUnread > 0 && (
            <span className="server-unread-badge">{formatBadgeCount(totalSocialUnread)}</span>
          )}
        </NavLink>
      </div>
      <div className="unified-sidebar-separator" aria-hidden />
      <div className="unified-sidebar-server-block">
        <ServerSidebar
          onCreateServer={onCreateServer}
          onJoinServer={onJoinServer}
          onOpenServerSettings={onOpenServerSettings}
          onSelectServer={handleSelectServer}
          displayActiveServerId={displayActiveServerId}
        />
      </div>
    </div>
  )
}
