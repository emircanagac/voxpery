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
  const { activeServerId, setActiveServer } = useAppStore(useShallow((s) => ({ activeServerId: s.activeServerId, setActiveServer: s.setActiveServer })))
  const isServerRoute = location.pathname === '/app/servers'
  const displayActiveServerId = isServerRoute ? activeServerId : null
  const totalSocialUnread = totalDmUnread + incomingRequestCount
  const hasMessagesNotify = totalSocialUnread > 0

  const handleSelectServer = (serverId: string) => {
    setActiveServer(serverId)
    navigate('/app/servers')
  }

  return (
    <div className="unified-sidebar">
      <div className="unified-sidebar-dm-section">
        <span className="unified-sidebar-section-label" title="Friends & private chats">
          Messages
        </span>
        <NavLink
          to="/app/friends"
          className={({ isActive }) =>
            `unified-dm-entry ${isActive ? 'active' : ''} ${hasMessagesNotify ? 'has-notify' : ''}`
          }
          title="Direct Messages — friends & private chats"
          aria-label="Direct Messages"
        >
          <MessageCircle size={22} />
          {totalSocialUnread > 0 && (
            <span className="server-unread-badge">{totalSocialUnread}</span>
          )}
        </NavLink>
      </div>
      <div className="unified-sidebar-separator" aria-hidden />
      <div className="unified-sidebar-server-block">
        <span className="unified-sidebar-section-label" title="Community servers">
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
