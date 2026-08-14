import { Outlet, useNavigate, useLocation } from 'react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../stores/app'
import ActiveCallBar from '../components/ActiveCallBar'
import QuickSwitcher, { type QuickSwitcherItem } from '../components/QuickSwitcher'
import UserBar from '../components/UserBar'
import NotificationPermissionPrompt from '../components/NotificationPermissionPrompt'
import FeedbackCard from '../components/FeedbackCard'
import { useToastStore } from '../stores/toast'
import { dmApi, friendApi, type DmChannel, type Friend, type User } from '../api'
import { touchDmChannelActivity, upsertDmChannel } from '../friendsList'
import { playMessageNotificationSound, shouldPlayNotificationSound } from '../notificationSound'
import {
  isAppBackgrounded,
  shouldShowPushNotification,
  showPushNotification,
} from '../pushNotifications'
import type { DmNotificationLocationState } from '../dmNotificationNavigation'
import { isSocialDmViewVisible } from '../socialView'
import { isTauri } from '../secureStorage'
import {
  checkForUpdates,
  DESKTOP_UPDATE_STATUS_EVENT,
  downloadAndInstallUpdate,
  getDesktopAppVersion,
  type DesktopUpdateStatusDetail,
  type UpdateResult,
} from '../updater'
import { ROUTES } from '../routes'
import { setPersistedSocialView } from '../socialView'
import { formatAppVersionBadge } from '../appVersion'

const DESKTOP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const SOCIAL_FALLBACK_SYNC_INTERVAL_MS = 5 * 60 * 1000
const SOCIAL_FOREGROUND_STALE_MS = 30 * 1000
const BUILD_APP_VERSION = formatAppVersionBadge(import.meta.env.VITE_APP_VERSION)

export default function AppShell() {
  const { user } = useAuthStore()
  const userId = user?.id ?? null
  const myStatus = useAuthStore((s) => s.user?.status)
  const token = useAuthStore((s) => s.token)
  const { connect, subscribe, send, isConnected, onReconnect } = useSocketStore()
  const {
    setVoiceState,
    setVoiceControl,
    setJoinedVoiceChannelId,
    dmChannelIds,
    dmChannels,
    setDmChannelIds,
    setDmChannels,
    setDmUnreadFromChannels,
    setFriends,
    setSocialDataReady,
    socialDataReady,
    activeDmChannelId,
    setActiveServer,
    setActiveChannel,
    incrementDmUnread,
    clearDmUnread,
    setActiveDmChannelId,
    mobileSidebarPanel,
    closeMobileSidebar,
  } = useAppStore(
    useShallow((s) => ({
      setVoiceState: s.setVoiceState,
      setVoiceControl: s.setVoiceControl,
      setJoinedVoiceChannelId: s.setJoinedVoiceChannelId,
      dmChannelIds: s.dmChannelIds,
      dmChannels: s.dmChannels,
      setDmChannelIds: s.setDmChannelIds,
      setDmChannels: s.setDmChannels,
      setDmUnreadFromChannels: s.setDmUnreadFromChannels,
      setFriends: s.setFriends,
      setSocialDataReady: s.setSocialDataReady,
      socialDataReady: s.socialDataReady,
      activeDmChannelId: s.activeDmChannelId,
      setActiveServer: s.setActiveServer,
      setActiveChannel: s.setActiveChannel,
      incrementDmUnread: s.incrementDmUnread,
      clearDmUnread: s.clearDmUnread,
      setActiveDmChannelId: s.setActiveDmChannelId,
      mobileSidebarPanel: s.mobileSidebarPanel,
      closeMobileSidebar: s.closeMobileSidebar,
    }))
  )
  const navigate = useNavigate()
  const location = useLocation()
  const pushToast = useToastStore((s) => s.pushToast)
  const [desktopUpdate, setDesktopUpdate] = useState<UpdateResult | null>(null)
  const [installingDesktopUpdate, setInstallingDesktopUpdate] = useState(false)
  const lastDesktopUpdateToastVersionRef = useRef<string | null>(null)
  const previousPathnameRef = useRef(location.pathname)
  const channels = useAppStore((s) => s.channels)
  const channelsByServerId = useAppStore((s) => s.channelsByServerId)
  const servers = useAppStore((s) => s.servers)
  const activeChannelId = useAppStore((s) => s.activeChannelId)
  const joinedVoiceChannelId = useAppStore((s) => s.joinedVoiceChannelId)
  const previousUnreadCountRef = useRef(0)
  const desktopUnreadInitializedRef = useRef(false)
  const [showQuickSwitcher, setShowQuickSwitcher] = useState(false)
  const [desktopAppVersion, setDesktopAppVersion] = useState<string | null>(null)
  const appVersionBadge = BUILD_APP_VERSION ?? desktopAppVersion
  const socialSyncInFlightRef = useRef<Promise<void> | null>(null)
  const socialSyncQueuedRef = useRef(false)
  const lastSocialSyncAtRef = useRef(0)

  useEffect(() => {
    if (BUILD_APP_VERSION || !isTauri()) return
    let cancelled = false

    void getDesktopAppVersion().then((version) => {
      if (!cancelled) {
        setDesktopAppVersion(formatAppVersionBadge(version))
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    connect(token ?? null)
  }, [connect, token, userId])

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
          title: 'Update available',
          message: `Voxpery ${result.version} can be installed when you are ready.`,
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
    }, DESKTOP_UPDATE_CHECK_INTERVAL_MS)
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
          (serverSum, channel) => {
            if (state.mutedChannelIds.includes(channel.id)) {
              return serverSum + (state.serverMentionsByChannel[channel.id] ?? 0)
            }
            return serverSum + (state.serverUnreadByChannel[channel.id] ?? 0)
          },
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
        || state.serverMentionsByChannel !== prev.serverMentionsByChannel
        || state.incomingRequestCount !== prev.incomingRequestCount
        || state.channelsByServerId !== prev.channelsByServerId
        || state.servers !== prev.servers
        || state.mutedServerIds !== prev.mutedServerIds
        || state.mutedChannelIds !== prev.mutedChannelIds
      ) {
        syncUnreadFeedback(state)
      }
    })

    return () => unsubscribe()
  }, [])

  const syncSocial = useCallback(async function runSocialSync(force = false) {
    if (!userId) return
    if (!force && Date.now() - lastSocialSyncAtRef.current < SOCIAL_FOREGROUND_STALE_MS) return
    if (socialSyncInFlightRef.current) {
      if (force) socialSyncQueuedRef.current = true
      return socialSyncInFlightRef.current
    }

    const request = Promise.all([
      dmApi.listChannels(token),
      friendApi.list(token),
    ]).then(([channels, friendList]) => {
      setDmChannelIds(channels.map((c) => c.id))
      setDmChannels(channels)
      setDmUnreadFromChannels(channels)
      setFriends(friendList)
      setSocialDataReady(true)
      lastSocialSyncAtRef.current = Date.now()
    }).catch(() => {
      // Keep the latest snapshot on transient failures.
    }).finally(() => {
      if (socialSyncInFlightRef.current === request) socialSyncInFlightRef.current = null
      if (socialSyncQueuedRef.current) {
        socialSyncQueuedRef.current = false
        window.setTimeout(() => { void runSocialSync(true) }, 0)
      }
    })
    socialSyncInFlightRef.current = request
    return request
  }, [setDmChannelIds, setDmChannels, setDmUnreadFromChannels, setFriends, setSocialDataReady, token, userId])

  useEffect(() => {
    if (!userId) return
    void syncSocial(true)
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void syncSocial()
    }, SOCIAL_FALLBACK_SYNC_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void syncSocial()
    }
    const unsubscribeReconnect = onReconnect(() => {
      void syncSocial(true)
    })
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(id)
      unsubscribeReconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onReconnect, syncSocial, userId])

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
        const e = evt as { type?: string; data?: { user?: User; user_id?: string; channel_id?: string | null; server_id?: string | null; channel_active_since_ms?: number | null; status?: string; muted?: boolean; deafened?: boolean; server_muted?: boolean; server_deafened?: boolean; screen_sharing?: boolean; camera_on?: boolean; message?: { author?: { user_id?: string } } } }
        if (e?.type === 'VoiceStateUpdate') {
          const { user_id, channel_id, server_id, channel_active_since_ms } = e.data ?? {}
          if (user_id) {
            setVoiceState(user_id, channel_id ?? null, channel_active_since_ms ?? null)
            useAppStore.getState().setVoiceStateServerId(user_id, server_id ?? null)
            if (user_id === userId) {
              setJoinedVoiceChannelId(channel_id ?? null)
            }
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
        if (e?.type === 'DmRead') {
          const payload = e.data as { channel_id?: string; user_id?: string }
          if (payload?.user_id === userId && payload.channel_id) {
            clearDmUnread(payload.channel_id)
          }
        }
        if (e?.type === 'FriendUpdate') {
          const payload = e.data as { user_id?: string }
          if (!payload.user_id || payload.user_id === userId) {
            void syncSocial(true)
          }
        }
        if (e?.type === 'NewMessage') {
          const payload = e?.data as { channel_id?: string; channel_type?: string; message?: { id?: string; created_at?: string; author?: { user_id?: string; username?: string } } }
          const channelId = payload?.channel_id
          const channelType = payload?.channel_type
          const incomingMessage = payload?.message
          const authorId = incomingMessage?.author?.user_id
          const isSocialWithVisibleDm = isSocialDmViewVisible(location.pathname)
          if (!channelId || channelType !== 'dm') return
          if (authorId && authorId === userId) return

          void (async () => {
            let currentChannels = useAppStore.getState().dmChannels
            let channel = currentChannels.find((c) => c.id === channelId)
            let dmIds = dmChannelIds
            if (!channel) {
              try {
                const latest = await dmApi.listChannels(token)
                currentChannels = latest
                dmIds = latest.map((c) => c.id)
                setDmChannels(latest)
                setDmChannelIds(dmIds)
                setDmUnreadFromChannels(latest)
                channel = latest.find((c) => c.id === channelId)
              } catch {
                // ignore refresh failure
              }
            }

            if (!channel && authorId) {
              try {
                const created = await dmApi.getOrCreateChannel(authorId, token)
                channel = created
                const next = upsertDmChannel(currentChannels, created)
                currentChannels = next
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

            const nextChannels = touchDmChannelActivity(
              currentChannels,
              channel.id,
              incomingMessage?.created_at ?? new Date().toISOString(),
            )
            setDmChannels(nextChannels)
            setDmChannelIds(nextChannels.map((c) => c.id))

            const canAutoReadActiveDm =
              isSocialWithVisibleDm
              && activeDmChannelId === channel.id
              && !isAppBackgrounded()

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
                  onClick: () => {
                    const messageId = incomingMessage?.id ?? null
                    const state: DmNotificationLocationState = {
                      dmNotificationAnchor: {
                        channelId: channel.id,
                        messageId,
                        notificationId: messageId ?? `${channel.id}:${Date.now()}`,
                      },
                    }
                    setPersistedSocialView('dm')
                    setActiveDmChannelId(channel.id)
                    navigate(ROUTES.dm, { state })
                  },
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
  }, [activeDmChannelId, clearDmUnread, dmChannelIds, dmChannels, incrementDmUnread, location.pathname, myStatus, navigate, pushToast, setActiveDmChannelId, setDmChannelIds, setDmChannels, setDmUnreadFromChannels, setFriends, setJoinedVoiceChannelId, setVoiceControl, setVoiceState, subscribe, syncSocial, token, userId])
  const activeChannel = useMemo(() => channels.find((c) => c.id === activeChannelId), [channels, activeChannelId])
  // Prefer the voice channel the user is viewing so switching channels leaves current and joins the new one.
  const selectedVoiceChannelId =
    (activeChannel?.channel_type === 'voice' ? activeChannel.id : null) ??
    joinedVoiceChannelId ??
    null
  const isFriendsOrDm =
    location.pathname === ROUTES.home || location.pathname === ROUTES.dm
  const isServerView =
    location.pathname === ROUTES.servers || location.pathname.startsWith(`${ROUTES.servers}/`)
  const showVoiceStage = isServerView ? !!activeChannelId : false
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
      navigate(ROUTES.dm)
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
    if (previousPathnameRef.current === location.pathname) {
      return
    }

    previousPathnameRef.current = location.pathname

    const isMatchingMobilePanel =
      (isFriendsOrDm && mobileSidebarPanel === 'social') ||
      (isServerView && mobileSidebarPanel === 'channels')

    if (isMatchingMobilePanel) {
      return
    }

    closeMobileSidebar()
  }, [closeMobileSidebar, isFriendsOrDm, isServerView, location.pathname, mobileSidebarPanel])

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
          <button type="button" className="shell-brand" onClick={() => navigate(ROUTES.home)}>
            <img src="/1024.png" alt="" className="shell-brand-logo" width={32} height={32} />
            <span>Voxpery</span>
            <span
              className="shell-brand-release"
              title={appVersionBadge ? `Beta channel, running build ${appVersionBadge}` : 'Beta channel'}
            >
              <span>Beta</span>
              {appVersionBadge && (
                <>
                  <span className="shell-brand-release-separator" aria-hidden="true">·</span>
                  <span className="shell-brand-release-version">{appVersionBadge}</span>
                </>
              )}
            </span>
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
            <span className="shell-quick-switch-mobile-label">Search</span>
            <span className="shell-quick-switch-shortcut">Ctrl K</span>
          </button>
        </div>
      </header>
      <main className="shell-content">
        <NotificationPermissionPrompt ready={socialDataReady} />
        <Outlet />
      </main>
      {/* Voice call bar — fixed to bottom of chat area, visible in both server and DM views */}
      <div className="callbar-overlay">
        <ActiveCallBar
          selectedVoiceChannelId={selectedVoiceChannelId}
          activeChannelId={showVoiceStage ? activeChannelId : null}
        />
      </div>
      <div className="feedback-dock">
        <FeedbackCard />
      </div>
      {/* User profile bar — stays in left sidebar */}
      <div className="left-bottom-panel">
        {isTauri() && desktopUpdate?.available && (
          <div className="shell-update-dock">
            <button
              type="button"
              className="shell-update-btn shell-update-btn--dock"
              onClick={() => void installDesktopUpdateNow()}
              disabled={installingDesktopUpdate}
              title={`Install Voxpery ${desktopUpdate.version}`}
            >
              <span className="shell-update-dock-copy">
                <span className="shell-update-dock-title">
                  {installingDesktopUpdate ? 'Installing update…' : `Install ${desktopUpdate.version}`}
                </span>
              </span>
              <ArrowDownToLine size={14} aria-hidden />
            </button>
          </div>
        )}
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

