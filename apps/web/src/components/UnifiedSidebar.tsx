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

export default function UnifiedSidebar({
  onCreateServer,
  onJoinServer,
  onOpenServerSettings,
  totalDmUnread = 0,
  incomingRequestCount = 0,
}: UnifiedSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeServerId, activeDmChannelId, setActiveServer } = useAppStore(
    useShallow((s) => ({
      activeServerId: s.activeServerId,
      activeDmChannelId: s.activeDmChannelId,
      setActiveServer: s.setActiveServer,
    }))
  )
  const isServerRoute = location.pathname.startsWith(ROUTES.servers)
  const displayActiveServerId = isServerRoute ? activeServerId : null
  const isSocialRoute = location.pathname === ROUTES.home || location.pathname === ROUTES.dm
  const totalSocialUnread = totalDmUnread + incomingRequestCount
  const hasMessagesNotify = totalSocialUnread > 0
  const savedSocialView = getPersistedSocialView()
  const socialHref = savedSocialView === 'dm' && activeDmChannelId ? ROUTES.dm : ROUTES.home

  const handleSelectServer = (serverId: string) => {
    setActiveServer(serverId)
    navigate(ROUTES.servers)
  }

  return (
    <div className="unified-sidebar">
      <div className="unified-sidebar-dm-section">
        <NavLink
          to={socialHref}
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
