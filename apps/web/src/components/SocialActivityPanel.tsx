import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Activity, ChevronRight, Radio, Volume2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { resolveAvatarUrl } from '../api'
import { ROUTES } from '../routes'
import { getSocialActivity, type SocialActivityEntry } from '../socialActivity'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'

function ActivityAvatar({ entry }: { entry: SocialActivityEntry }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = entry.avatarUrl ? resolveAvatarUrl(entry.avatarUrl) : null
  return <span className="social-activity-avatar" aria-hidden="true">
    {url && url !== failedUrl
      ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(url)} />
      : entry.username.slice(0, 1).toUpperCase()}
  </span>
}

export default function SocialActivityPanel() {
  const navigate = useNavigate()
  const userId = useAuthStore(state => state.user?.id)
  const { connected, connectionId } = useSocketStore(useShallow(state => ({ connected: state.isConnected, connectionId: state.connectionId })))
  const source = useAppStore(useShallow(state => ({
    servers: state.servers, channelsByServerId: state.channelsByServerId, friends: state.friends,
    voiceStates: state.voiceStates, voiceStateServerIds: state.voiceStateServerIds,
    voiceControls: state.voiceControls, voiceActivityConnectionIds: state.voiceActivityConnectionIds,
  })))
  const loading = useAppStore(state => state.serversLoading || !state.socialDataReady)
  const activity = useMemo(() => getSocialActivity(source, userId, connectionId), [source, userId, connectionId])

  const openChannel = (entry: SocialActivityEntry) => {
    if (!useSocketStore.getState().isConnected || useAuthStore.getState().user?.id !== userId) return
    const current = getSocialActivity(useAppStore.getState(), userId, useSocketStore.getState().connectionId)
    if (!current.some(item => item.userId === entry.userId && item.channel.id === entry.channel.id && item.server.id === entry.server.id)) return
    useAppStore.getState().setActiveServer(entry.server.id)
    useAppStore.getState().setActiveChannel(entry.channel.id)
    navigate(ROUTES.servers)
  }

  return <>
    <h2 className="social-activity-title"><Activity size={18} aria-hidden="true" /><span>Friend Activity</span></h2>
    <div className="social-activity-body" aria-label="Friend activity">
      {!connected || loading ? <p className="social-activity-empty" role="status">
        {!connected ? 'Reconnecting to activity...' : 'Loading activity...'}
      </p> : activity.length > 0 ? <section aria-label="Friends in voice">
        <h3 className="social-activity-heading">Friends in voice</h3>
        {activity.map(entry => <button type="button" className="social-activity-row social-activity-channel" key={entry.userId}
          aria-label={`Open ${entry.channel.name}, ${entry.username} in voice`} title="Open channel" onClick={() => openChannel(entry)}>
          <ActivityAvatar entry={entry} />
          <span className="social-activity-copy">
            <strong title={entry.username}>{entry.username}</strong>
            <span title={`${entry.server.name} / ${entry.channel.name}`}>{entry.server.name} / {entry.channel.name}</span>
          </span>
          <span className="social-activity-indicators">
            {entry.screenSharing
              ? <Radio size={16} role="img" aria-label="Screen sharing" className="social-activity-sharing" />
              : <Volume2 size={16} aria-hidden="true" />}
            <ChevronRight size={14} aria-hidden="true" />
          </span>
        </button>)}
      </section> : <p className="social-activity-empty">No friends in voice right now.</p>}
    </div>
  </>
}
