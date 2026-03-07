import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import ServerSidebar from './ServerSidebar'

interface UnifiedSidebarProps {
  onCreateServer: () => void
  onJoinServer: () => void
  onOpenServerSettings?: (serverId: string) => void
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
  const { activeServerId, setActiveServer } = useAppStore(
    useShallow((s) => ({ activeServerId: s.activeServerId, setActiveServer: s.setActiveServer }))
  )
  const isServerRoute = location.pathname === '/app/servers'
  const displayActiveServerId = isServerRoute ? activeServerId : null
  const isSocialRoute = location.pathname === '/app/social'
  const totalSocialUnread = totalDmUnread + incomingRequestCount
  const hasMessagesNotify = totalSocialUnread > 0
  const socialHref = '/app/social'

  const handleSelectServer = (serverId: string) => {
    setActiveServer(serverId)
    navigate('/app/servers')
  }

  return (
    <div className="unified-sidebar">
      <div className="unified-sidebar-dm-section">
        <span className="unified-sidebar-section-label" title="Friends, requests, and direct messages">
          Social
        </span>
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
            <span className="server-unread-badge">{totalSocialUnread}</span>
          )}
        </NavLink>
      </div>
      <div className="unified-sidebar-separator" aria-hidden />
      <div className="unified-sidebar-server-block">
        <span className="unified-sidebar-section-label" title="Community servers and channels">
          Servers
        </span>
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
