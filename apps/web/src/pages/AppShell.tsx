import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef } from 'react'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import ActiveCallBar from '../components/ActiveCallBar'
import UserBar from '../components/UserBar'
import { useToastStore } from '../stores/toast'
import { authApi, dmApi, friendApi, type DmChannel, type Friend, type User } from '../api'
import { playMessageNotificationSound, shouldPlayNotificationSound } from '../notificationSound'
import { preloadRnnoiseWorklet } from '../webrtc/rnnoise'

const LAST_STATUS_KEY = 'voxpery-last-status'

export default function AppShell() {
  const { user, setUserStatus } = useAuthStore()
  const myStatus = useAuthStore((s) => s.user?.status)
  const token = useAuthStore((s) => s.token)
  const statusRestoredRef = useRef(false)
  const { connect, subscribe, send, isConnected } = useSocketStore()
  const {
    setVoiceState,
    setVoiceControl,
    dmChannelIds,
    dmChannels,
    setDmChannelIds,
    setDmChannels,
    setFriends,
    activeDmChannelId,
    incrementDmUnread,
    clearDmUnread,
    setActiveDmChannelId,
  } = useAppStore(
    useShallow((s) => ({
      setVoiceState: s.setVoiceState,
      setVoiceControl: s.setVoiceControl,
      dmChannelIds: s.dmChannelIds,
      dmChannels: s.dmChannels,
      setDmChannelIds: s.setDmChannelIds,
      setDmChannels: s.setDmChannels,
      setFriends: s.setFriends,
      activeDmChannelId: s.activeDmChannelId,
      incrementDmUnread: s.incrementDmUnread,
      clearDmUnread: s.clearDmUnread,
      setActiveDmChannelId: s.setActiveDmChannelId,
    }))
  )
  const navigate = useNavigate()
  const location = useLocation()
  const pushToast = useToastStore((s) => s.pushToast)

  // Preload RNNoise worklet (~4.8 MB) so first voice join is faster
  useEffect(() => {
    preloadRnnoiseWorklet()
  }, [])

  useEffect(() => {
    if (!user) return
    connect(token ?? null)
  }, [connect, token, user])

  // Restore last chosen status after F5 or re-login, once WS is connected (so we overwrite backend's "online" if user had "offline").
  useEffect(() => {
    if (!user || statusRestoredRef.current || !isConnected) return
    const last = localStorage.getItem(LAST_STATUS_KEY)
    const valid = last === 'online' || last === 'dnd' || last === 'offline'
    if (!valid) {
      statusRestoredRef.current = true
      return
    }
    if (user.status === last) {
      statusRestoredRef.current = true
      return
    }
    statusRestoredRef.current = true
    authApi.updateStatus(last as 'online' | 'dnd' | 'offline', token ?? null).then(
      (updated) => setUserStatus(updated.status),
      () => { },
    )
  }, [token, user, setUserStatus, isConnected])

  useEffect(() => {
    if (!user) return
    const syncSocial = async () => {
      try {
        const [channels, friendList] = await Promise.all([
          dmApi.listChannels(token),
          friendApi.list(token),
        ])
        setDmChannelIds(channels.map((c) => c.id))
        setDmChannels(channels)
        setFriends(friendList)
      } catch {
        // ignore transient failures
      }
    }
    syncSocial()
    const id = window.setInterval(syncSocial, 2000)
    return () => window.clearInterval(id)
  }, [setActiveDmChannelId, setDmChannelIds, setDmChannels, setFriends, token, user])

  useEffect(() => {
    if (!isConnected || dmChannelIds.length === 0) return
    send('Subscribe', { channel_ids: dmChannelIds })
    return () => {
      send('Unsubscribe', { channel_ids: dmChannelIds })
    }
  }, [dmChannelIds, isConnected, send])

  useEffect(() => {
    const unsub = subscribe((evt: unknown) => {
      try {
        const e = evt as { type?: string; data?: { user?: User; user_id?: string; channel_id?: string | null; server_id?: string | null; status?: string; muted?: boolean; deafened?: boolean; screen_sharing?: boolean; camera_on?: boolean; message?: { author?: { user_id?: string } } } }
        if (e?.type === 'VoiceStateUpdate') {
          const { user_id, channel_id, server_id } = e.data ?? {}
          if (user_id) {
            setVoiceState(user_id, channel_id ?? null)
            useAppStore.getState().setVoiceStateServerId(user_id, server_id ?? null)
          }
        }
        if (e?.type === 'PresenceUpdate') {
          const { user_id, status } = e.data ?? {}
          if (!user_id || !status) return
          const store = useAppStore.getState()
          const members = store.members ?? []
          store.setMembers(
            members.map((m) => (m.user_id === user_id ? { ...m, status } : m)),
          )
        }
        if (e?.type === 'VoiceControlUpdate') {
          const { user_id, muted, deafened, screen_sharing, camera_on } = e.data ?? {}
          if (user_id) {
            setVoiceControl(user_id, !!muted, !!deafened, !!screen_sharing)
            useAppStore.getState().setVoiceCamera(user_id, !!camera_on)
          }
        }
        if (e?.type === 'UserUpdated') {
          const updatedUser = e.data?.user
          if (!updatedUser || !updatedUser.id) return

          const store = useAppStore.getState()
          const members = store.members ?? []

          // Update in server members list (if viewing a server)
          if (members.some((m) => m.user_id === updatedUser.id)) {
            store.setMembers(
              members.map((m) =>
                m.user_id === updatedUser.id ? { ...m, username: updatedUser.username ?? m.username, avatar_url: updatedUser.avatar_url ?? null, status: updatedUser.status ?? m.status } : m
              )
            )
          }

          // Update cached server members lists
          Object.entries(store.membersByServerId ?? {}).forEach(([serverId, serverMembers]) => {
            if (!serverMembers.some((member) => member.user_id === updatedUser.id)) return
            store.setMembersForServer(
              serverId,
              serverMembers.map((member) =>
                member.user_id === updatedUser.id
                  ? {
                    ...member,
                    username: updatedUser.username ?? member.username,
                    avatar_url: updatedUser.avatar_url ?? null,
                    status: updatedUser.status ?? member.status,
                  }
                  : member,
              ),
            )
          })

          // Update in friends list
          const currentFriends = store.friends ?? []
          setFriends(
            currentFriends.map((f: Friend) => (f.id === updatedUser.id ? { ...f, ...updatedUser, avatar_url: updatedUser.avatar_url ?? null } : f))
          )

          // Update in DM channels
          const currentDmChannels = store.dmChannels ?? []
          setDmChannels(
            currentDmChannels.map((c: DmChannel) => {
              if (c.peer_id === updatedUser.id) {
                return {
                  ...c,
                  peer_username: updatedUser.username ?? c.peer_username,
                  peer_avatar_url: updatedUser.avatar_url ?? null,
                }
              }
              return c
            })
          )
        }
        if (e?.type === 'NewMessage') {
          const payload = e?.data as { channel_id?: string; channel_type?: string; message?: { author?: { user_id?: string; username?: string } } }
          const channelId = payload?.channel_id
          const channelType = payload?.channel_type
          const incomingMessage = payload?.message
          const authorId = incomingMessage?.author?.user_id
          const isSocialWithDm = location.pathname === '/app/social'
          if (!channelId || channelType !== 'dm') return
          if (authorId && authorId === user?.id) return

          void (async () => {
            let channel = dmChannels.find((c) => c.id === channelId)
            let dmIds = dmChannelIds
            if (!channel) {
              try {
                const latest = await dmApi.listChannels(token)
                dmIds = latest.map((c) => c.id)
                setDmChannels(latest)
                setDmChannelIds(dmIds)
                channel = latest.find((c) => c.id === channelId)
              } catch {
                // ignore refresh failure
              }
            }

            if (!channel && authorId) {
              try {
                const created = await dmApi.getOrCreateChannel(authorId, token)
                channel = created
                const next = [created, ...dmChannels.filter((c) => c.id !== created.id)]
                dmIds = next.map((c) => c.id)
                setDmChannels(next)
                setDmChannelIds(dmIds)
              } catch {
                // ignore fallback channel creation failure
              }
            }

            if (!channel || !dmIds.includes(channel.id)) return

            if (channel.id !== channelId && activeDmChannelId !== channel.id) {
              clearDmUnread(channelId)
              incrementDmUnread(channel.id)
            }

            const nextChannels = [channel, ...dmChannels.filter((c) => c.id !== channel.id)]
            setDmChannels(nextChannels)
            setDmChannelIds(nextChannels.map((c) => c.id))

            if (isSocialWithDm && activeDmChannelId === channel.id) {
              clearDmUnread(channel.id)
              return
            }

            if (!isSocialWithDm || activeDmChannelId !== channel.id) {
              incrementDmUnread(channel.id)
              if (shouldPlayNotificationSound(myStatus)) {
                playMessageNotificationSound()
              }
            }
          })()
        }
      } catch (err) {
        console.error('AppShell WS handler error:', err)
      }
    })
    return () => unsub()
  }, [activeDmChannelId, clearDmUnread, dmChannelIds, dmChannels, incrementDmUnread, location.pathname, myStatus, navigate, pushToast, setActiveDmChannelId, setDmChannelIds, setDmChannels, setFriends, setVoiceControl, setVoiceState, subscribe, token, user?.id])
  const channels = useAppStore((s) => s.channels)
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const activeServerId = useAppStore((s) => s.activeServerId)
  const joinedVoiceChannelId = useAppStore((s) => s.joinedVoiceChannelId)
  const activeChannel = useMemo(() => channels.find((c) => c.id === activeChannelId), [channels, activeChannelId])
  // Prefer the voice channel the user is viewing so switching channels leaves current and joins the new one.
  const selectedVoiceChannelId =
    (activeChannel?.channel_type === 'voice' ? activeChannel.id : null) ??
    joinedVoiceChannelId ??
    null
  const isFriendsOrDm =
    location.pathname === '/app/social' || location.pathname === '/app'
  const isServerView = !!activeServerId && location.pathname.startsWith('/app/servers')
  const showVoiceStage = isServerView ? !!activeChannelId : false

  return (
    <div className={`shell-layout${isFriendsOrDm ? ' shell-layout-social' : ''}`}>
      <header className="shell-topbar">
        <div className="shell-left">
          <button type="button" className="shell-brand" onClick={() => navigate('/app/social')}>
            <img src="/1024.png" alt="" className="shell-brand-logo" width={32} height={32} />
            <span>Voxpery</span>
            <span className="shell-brand-beta" title="Preview build">Beta</span>
          </button>
        </div>
      </header>
      <main className="shell-content">
        <Outlet />
      </main>
      {/* Voice call bar — fixed to bottom of chat area, visible in both server and DM views */}
      <div className="callbar-overlay">
        <ActiveCallBar
          selectedVoiceChannelId={selectedVoiceChannelId}
          activeChannelId={showVoiceStage ? activeChannelId : null}
        />
      </div>
      {/* User profile bar — stays in left sidebar */}
      <div className="left-bottom-panel">
        <UserBar />
      </div>

    </div>
  )
}

