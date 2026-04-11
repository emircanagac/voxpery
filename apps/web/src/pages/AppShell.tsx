import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Menu, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import ActiveCallBar from '../components/ActiveCallBar'
import QuickSwitcher, { type QuickSwitcherItem } from '../components/QuickSwitcher'
import UserBar from '../components/UserBar'
import { useToastStore } from '../stores/toast'
import { dmApi, friendApi, type DmChannel, type Friend, type User } from '../api'
import { playMessageNotificationSound, shouldPlayNotificationSound } from '../notificationSound'
import {
  shouldShowPushNotification,
  showPushNotification,
} from '../pushNotifications'
import { isSocialDmViewVisible } from '../socialView'
import { isTauri } from '../secureStorage'
import {
  checkForUpdates,
  DESKTOP_UPDATE_STATUS_EVENT,
  downloadAndInstallUpdate,
  type DesktopUpdateStatusDetail,
  type UpdateResult,
} from '../updater'
import { ROUTES } from '../routes'
import { setPersistedSocialView } from '../socialView'

export default function AppShell() {
  const { user } = useAuthStore()
  const myStatus = useAuthStore((s) => s.user?.status)
  const token = useAuthStore((s) => s.token)
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
    setActiveServer,
    setActiveChannel,
    incrementDmUnread,
    clearDmUnread,
    setActiveDmChannelId,
    mobileSidebarPanel,
    setMobileSidebarPanel,
    closeMobileSidebar,
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
      setActiveServer: s.setActiveServer,
      setActiveChannel: s.setActiveChannel,
      incrementDmUnread: s.incrementDmUnread,
      clearDmUnread: s.clearDmUnread,
      setActiveDmChannelId: s.setActiveDmChannelId,
      mobileSidebarPanel: s.mobileSidebarPanel,
      setMobileSidebarPanel: s.setMobileSidebarPanel,
      closeMobileSidebar: s.closeMobileSidebar,
    }))
  )
  const navigate = useNavigate()
  const location = useLocation()
  const pushToast = useToastStore((s) => s.pushToast)
  const [desktopUpdate, setDesktopUpdate] = useState<UpdateResult | null>(null)
  const [installingDesktopUpdate, setInstallingDesktopUpdate] = useState(false)
  const lastDesktopUpdateToastVersionRef = useRef<string | null>(null)
  const channels = useAppStore((s) => s.channels)
  const channelsByServerId = useAppStore((s) => s.channelsByServerId)
  const servers = useAppStore((s) => s.servers)
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const activeServerId = useAppStore((s) => s.activeServerId)
  const joinedVoiceChannelId = useAppStore((s) => s.joinedVoiceChannelId)
  const previousUnreadCountRef = useRef(0)
  const desktopUnreadInitializedRef = useRef(false)
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)

  useEffect(() => {
    if (!user) return
    connect(token ?? null)
  }, [connect, token, user])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setShowQuickSwitcher(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const applyUpdateResult = (result: UpdateResult) => {
      if (cancelled) return
      setDesktopUpdate((previous) => {
        if (result.available) return result
        if (result.error && previous?.available) return previous
        return result
      })
      if (
        result.available
        && lastDesktopUpdateToastVersionRef.current !== result.version
      ) {
        lastDesktopUpdateToastVersionRef.current = result.version
        pushToast({
          level: 'info',
          title: 'Desktop update available',
          message: `Voxpery ${result.version} is ready to install.`,
        })
      }
    }
    const onUpdateStatus = (event: Event) => {
      const detail = (event as CustomEvent<DesktopUpdateStatusDetail>).detail
      if (!detail) return
      applyUpdateResult(detail.result)
    }
    window.addEventListener(DESKTOP_UPDATE_STATUS_EVENT, onUpdateStatus as EventListener)
    const run = async () => {
      const result = await checkForUpdates()
      applyUpdateResult(result)
    }
    void run()
    const intervalId = window.setInterval(() => {
      void run()
    }, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.removeEventListener(DESKTOP_UPDATE_STATUS_EVENT, onUpdateStatus as EventListener)
      window.clearInterval(intervalId)
    }
  }, [pushToast])

  useEffect(() => {
    const syncUnreadFeedback = (state: ReturnType<typeof useAppStore.getState>) => {
      const dmTotal = state.dmChannels.reduce(
        (sum, channel) => sum + (state.dmUnread[channel.id] ?? 0),
        0,
      )
      const serverTotal = state.servers.reduce((sum, server) => {
        if (state.mutedServerIds.includes(server.id)) return sum
        const serverChannels = state.channelsByServerId[server.id] ?? []
        const serverUnread = serverChannels.reduce(
          (serverSum, channel) => serverSum + (state.serverUnreadByChannel[channel.id] ?? 0),
          0,
        )
        return sum + serverUnread
      }, 0)
      const totalUnreadCount = dmTotal + serverTotal + state.incomingRequestCount
      document.title = 'Voxpery'

      if (!isTauri()) {
        previousUnreadCountRef.current = totalUnreadCount
        return
      }

      const isFirstDesktopSync = !desktopUnreadInitializedRef.current
      const effectiveUnreadCount = isFirstDesktopSync ? 0 : totalUnreadCount
      const unreadIncreasedSinceLastSync =
        !isFirstDesktopSync
        && totalUnreadCount > 0
        && totalUnreadCount > previousUnreadCountRef.current

      previousUnreadCountRef.current = totalUnreadCount
      desktopUnreadInitializedRef.current = true

      void invoke('desktop_update_unread_feedback', {
        unreadCount: effectiveUnreadCount,
        unreadIncreased: unreadIncreasedSinceLastSync,
      }).catch(() => {
        // Keep browser title as fallback even if native desktop feedback fails.
      })
    }

    syncUnreadFeedback(useAppStore.getState())

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (
        state.dmUnread !== prev.dmUnread
        || state.dmChannels !== prev.dmChannels
        || state.serverUnreadByChannel !== prev.serverUnreadByChannel
        || state.incomingRequestCount !== prev.incomingRequestCount
        || state.channelsByServerId !== prev.channelsByServerId
        || state.servers !== prev.servers
        || state.mutedServerIds !== prev.mutedServerIds
      ) {
        syncUnreadFeedback(state)
      }
    })

    return () => unsubscribe()
  }, [])

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
        const e = evt as { type?: string; data?: { user?: User; user_id?: string; channel_id?: string | null; server_id?: string | null; status?: string; muted?: boolean; deafened?: boolean; server_muted?: boolean; server_deafened?: boolean; screen_sharing?: boolean; camera_on?: boolean; message?: { author?: { user_id?: string } } } }
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
          if (members.some((m) => m.user_id === user_id)) {
            store.setMembers(
              members.map((m) => (m.user_id === user_id ? { ...m, status } : m)),
            )
          }

          Object.entries(store.membersByServerId ?? {}).forEach(([serverId, serverMembers]) => {
            if (!serverMembers.some((member) => member.user_id === user_id)) return
            store.setMembersForServer(
              serverId,
              serverMembers.map((member) =>
                member.user_id === user_id ? { ...member, status } : member,
              ),
            )
          })

          const currentFriends = store.friends ?? []
          if (currentFriends.some((f) => f.id === user_id)) {
            setFriends(
              currentFriends.map((f: Friend) => (f.id === user_id ? { ...f, status } : f)),
            )
          }

          const currentDmChannels = store.dmChannels ?? []
          if (currentDmChannels.some((c) => c.peer_id === user_id)) {
            setDmChannels(
              currentDmChannels.map((c: DmChannel) =>
                c.peer_id === user_id ? { ...c, peer_status: status } : c,
              ),
            )
          }
        }
        if (e?.type === 'VoiceControlUpdate') {
          const { user_id, muted, deafened, server_muted, server_deafened, screen_sharing, camera_on } = e.data ?? {}
          if (user_id) {
            setVoiceControl(user_id, !!muted, !!deafened, !!screen_sharing, !!server_muted, !!server_deafened)
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
          const isSocialWithVisibleDm = isSocialDmViewVisible(location.pathname)
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

            let unreadHandled = false

            if (channel.id !== channelId && activeDmChannelId !== channel.id) {
              clearDmUnread(channelId)
              incrementDmUnread(channel.id)
              unreadHandled = true
            }

            const nextChannels = [channel, ...dmChannels.filter((c) => c.id !== channel.id)]
            setDmChannels(nextChannels)
            setDmChannelIds(nextChannels.map((c) => c.id))

            const canAutoReadActiveDm =
              isSocialWithVisibleDm
              && activeDmChannelId === channel.id

            if (canAutoReadActiveDm) {
              clearDmUnread(channel.id)
              return
            }

            if (!unreadHandled) {
              incrementDmUnread(channel.id)
            }

            if (!canAutoReadActiveDm) {
              if (shouldPlayNotificationSound(myStatus)) {
                playMessageNotificationSound()
              }
              if (shouldShowPushNotification(myStatus)) {
                showPushNotification({
                  title: incomingMessage?.author?.username ?? channel.peer_username,
                  body: 'sent you a direct message',
                  tag: `dm:${channel.id}`,
                })
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
  const activeChannel = useMemo(() => channels.find((c) => c.id === activeChannelId), [channels, activeChannelId])
  // Prefer the voice channel the user is viewing so switching channels leaves current and joins the new one.
  const selectedVoiceChannelId =
    (activeChannel?.channel_type === 'voice' ? activeChannel.id : null) ??
    joinedVoiceChannelId ??
    null
  const isFriendsOrDm =
    location.pathname === '/'
  const isServerView = !!activeServerId && location.pathname.startsWith('/servers')
  const showVoiceStage = isServerView ? !!activeChannelId : false
  const mobileSidebarTarget = isFriendsOrDm ? 'social' : isServerView ? 'channels' : 'none'

  const quickSwitcherItems = useMemo<QuickSwitcherItem[]>(() => {
    const serverItems: QuickSwitcherItem[] = servers.map((server) => ({
      id: `server:${server.id}`,
      kind: 'server',
      label: server.name,
      subtitle: 'Jump to server',
      searchText: `${server.name} ${server.invite_code ?? ''}`,
    }))

    const channelItems: QuickSwitcherItem[] = Object.values(channelsByServerId)
      .flatMap((serverChannels) => serverChannels)
      .filter((channel) => channel.channel_type === 'text')
      .map((channel) => {
        const serverName = servers.find((server) => server.id === channel.server_id)?.name ?? 'Server'
        return {
          id: `channel:${channel.id}`,
          kind: 'channel' as const,
          label: `# ${channel.name}`,
          subtitle: serverName,
          searchText: `${channel.name} ${serverName}`,
        }
      })

    const dmItems: QuickSwitcherItem[] = dmChannels.map((channel) => ({
      id: `dm:${channel.id}`,
      kind: 'dm',
      label: channel.peer_username,
      subtitle: 'Direct message',
      searchText: `${channel.peer_username} direct message dm`,
    }))

    return [...dmItems, ...serverItems, ...channelItems]
  }, [channelsByServerId, dmChannels, servers])

  const handleQuickSwitchSelect = (item: QuickSwitcherItem) => {
    setShowQuickSwitcher(false)

    if (item.kind === 'dm') {
      const dmChannelId = item.id.replace('dm:', '')
      setPersistedSocialView('dm')
      setActiveDmChannelId(dmChannelId)
      clearDmUnread(dmChannelId)
      navigate(ROUTES.home)
      return
    }

    if (item.kind === 'server') {
      const serverId = item.id.replace('server:', '')
      const serverChannels = channelsByServerId[serverId] ?? []
      const defaultChannelId = serverChannels.find((channel) => channel.channel_type === 'text')?.id ?? serverChannels[0]?.id ?? null
      setActiveServer(serverId)
      setActiveChannel(defaultChannelId)
      navigate(ROUTES.servers)
      return
    }

    const channelId = item.id.replace('channel:', '')
    const channel = Object.values(channelsByServerId)
      .flatMap((serverChannels) => serverChannels)
      .find((entry) => entry.id === channelId)
    if (!channel) return
    setActiveServer(channel.server_id)
    setActiveChannel(channel.id)
    navigate(ROUTES.servers)
  }

  useEffect(() => {
    closeMobileSidebar()
  }, [closeMobileSidebar, location.pathname])

  const installDesktopUpdateNow = async () => {
    setInstallingDesktopUpdate(true)
    try {
      const ok = await downloadAndInstallUpdate()
      if (!ok) {
        pushToast({
          level: 'error',
          title: 'Update failed',
          message: 'Could not download or install the desktop update. Try again later.',
        })
        return
      }
      pushToast({
        level: 'info',
        title: 'Installing update',
        message: 'Voxpery will restart after the update is applied.',
      })
    } finally {
      setInstallingDesktopUpdate(false)
    }
  }

  return (
    <div className={`shell-layout${isFriendsOrDm ? ' shell-layout-social' : ''}`}>
      <header className="shell-topbar">
        <div className="shell-left">
          {mobileSidebarTarget !== 'none' && (
            <button
              type="button"
              className={`shell-topbar-toggle ${mobileSidebarPanel === mobileSidebarTarget ? 'is-active' : ''}`}
              onClick={() =>
                setMobileSidebarPanel(
                  mobileSidebarPanel === mobileSidebarTarget ? 'none' : mobileSidebarTarget,
                )}
              aria-label={mobileSidebarTarget === 'social' ? 'Toggle social sidebar' : 'Toggle channel sidebar'}
              title={mobileSidebarTarget === 'social' ? 'Toggle social sidebar' : 'Toggle channel sidebar'}
            >
              <Menu size={18} />
            </button>
          )}
          <button type="button" className="shell-brand" onClick={() => navigate('/')}>
            <img src="/1024.png" alt="" className="shell-brand-logo" width={32} height={32} />
            <span>Voxpery</span>
            <span className="shell-brand-beta" title="Preview build">Beta</span>
          </button>
        </div>
        <div className="shell-topbar-right">
          <button
            type="button"
            className="shell-quick-switch-btn"
            onClick={() => setShowQuickSwitcher(true)}
            title="Search servers, channels, and direct messages"
          >
            <Search size={14} />
            <span className="shell-quick-switch-label">Quick Search</span>
            <span className="shell-quick-switch-shortcut">Ctrl K</span>
          </button>
        </div>
        {isTauri() && desktopUpdate?.available && (
          <div className="shell-topbar-center">
            <button
              type="button"
              className="shell-update-btn shell-update-btn--topbar"
              onClick={() => void installDesktopUpdateNow()}
              disabled={installingDesktopUpdate}
              title={`Install Voxpery ${desktopUpdate.version}`}
            >
              {installingDesktopUpdate ? 'Installing update…' : `Update ${desktopUpdate.version}`}
            </button>
          </div>
        )}
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
      {showQuickSwitcher && (
        <QuickSwitcher
          items={quickSwitcherItems}
          onClose={() => setShowQuickSwitcher(false)}
          onSelect={handleQuickSwitchSelect}
        />
      )}
    </div>
  )
}

