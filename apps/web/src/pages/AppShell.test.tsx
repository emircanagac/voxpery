import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DmChannel, Friend, User } from '../api'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import AppShell from './AppShell'

const apiMocks = vi.hoisted(() => ({
  createWebSocket: vi.fn(),
  listDmChannels: vi.fn(),
  listFriends: vi.fn(),
}))

const pushMocks = vi.hoisted(() => ({
  isAppBackgrounded: vi.fn(() => false),
  shouldShowPushNotification: vi.fn(() => false),
  showPushNotification: vi.fn(),
}))

vi.mock('../api', () => ({
  createWebSocket: apiMocks.createWebSocket,
  dmApi: {
    listChannels: apiMocks.listDmChannels,
    getOrCreateChannel: vi.fn(),
  },
  friendApi: {
    list: apiMocks.listFriends,
  },
}))

vi.mock('../components/ActiveCallBar', () => ({
  default: () => <div data-testid="active-call-bar" />,
}))

vi.mock('../components/QuickSwitcher', () => ({
  default: () => null,
}))

vi.mock('../components/UserBar', () => ({
  default: () => <div data-testid="user-bar" />,
}))

vi.mock('../components/NotificationPermissionPrompt', () => ({
  default: () => null,
}))

vi.mock('../notificationSound', () => ({
  playMessageNotificationSound: vi.fn(),
  shouldPlayNotificationSound: vi.fn(() => false),
}))

vi.mock('../pushNotifications', () => ({
  isAppBackgrounded: pushMocks.isAppBackgrounded,
  shouldShowPushNotification: pushMocks.shouldShowPushNotification,
  showPushNotification: pushMocks.showPushNotification,
}))

vi.mock('../secureStorage', () => ({
  isTauri: vi.fn(() => false),
}))

vi.mock('../updater', () => ({
  DESKTOP_UPDATE_STATUS_EVENT: 'voxpery-desktop-update-status',
  checkForUpdates: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
  getDesktopAppVersion: vi.fn(),
}))

const localUser: User = {
  id: 'user-local',
  username: 'admin',
  email: 'admin@example.test',
  email_verified: true,
  status: 'online',
}

function dmChannel(id: string, peerId = 'friend-1', peerUsername = 'friend'): DmChannel {
  return {
    id,
    peer_id: peerId,
    peer_username: peerUsername,
    peer_avatar_url: null,
    peer_status: 'online',
    last_message_at: null,
    unread_count: 0,
    pinned_at: null,
    is_pinned: false,
  }
}

function friend(id: string, username: string): Friend {
  return {
    id,
    username,
    avatar_url: null,
    status: 'online',
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="shell-child" data-location-state={JSON.stringify(location.state)} />
}

function renderAppShell(initialEntry = '/channels/@me') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/channels/@me" element={<LocationProbe />} />
          <Route path="/social/dm" element={<LocationProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppShell social refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()

    apiMocks.createWebSocket.mockReturnValue({
      readyState: WebSocket.CONNECTING,
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onclose: null,
      onmessage: null,
    })
    apiMocks.listDmChannels.mockResolvedValue([dmChannel('dm-1')])
    apiMocks.listFriends.mockResolvedValue([friend('friend-1', 'friend')])
    pushMocks.isAppBackgrounded.mockReturnValue(false)
    pushMocks.shouldShowPushNotification.mockReturnValue(false)

    useAuthStore.setState({
      token: 'token',
      user: localUser,
      loggingOut: false,
    })
    useAppStore.getState().resetSessionState()
    useSocketStore.setState({
      socket: null,
      isConnected: false,
      token: null,
      shouldReconnect: false,
      listeners: new Set(),
      reconnectListeners: new Set(),
      reconnectAttempt: 0,
      reconnectTimer: null,
      connectionId: 0,
      wasConnectedBefore: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps social data fresh from events and reconnects instead of aggressive polling', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')

    renderAppShell()

    await waitFor(() => {
      expect(apiMocks.listDmChannels).toHaveBeenCalledTimes(1)
      expect(apiMocks.listFriends).toHaveBeenCalledTimes(1)
    })
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000)
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 6_000)
    expect(useAppStore.getState().socialDataReady).toBe(true)

    act(() => {
      useSocketStore.getState().listeners.forEach((listener) => {
        listener({ type: 'FriendUpdate', data: { user_id: 'other-user' } })
      })
    })

    expect(apiMocks.listDmChannels).toHaveBeenCalledTimes(1)

    act(() => {
      useSocketStore.getState().listeners.forEach((listener) => {
        listener({ type: 'FriendUpdate', data: { user_id: localUser.id } })
      })
    })

    await waitFor(() => {
      expect(apiMocks.listDmChannels).toHaveBeenCalledTimes(2)
      expect(apiMocks.listFriends).toHaveBeenCalledTimes(2)
    })

    act(() => {
      useSocketStore.getState().reconnectListeners.forEach((listener) => listener())
    })

    await waitFor(() => {
      expect(apiMocks.listDmChannels).toHaveBeenCalledTimes(3)
      expect(apiMocks.listFriends).toHaveBeenCalledTimes(3)
    })
  })

  it('keeps a background DM unread until its notification target is opened', async () => {
    const channel = dmChannel('dm-1')
    sessionStorage.setItem('voxpery-social-view', 'dm')
    useAppStore.setState({
      activeDmChannelId: channel.id,
      dmChannels: [channel],
      dmChannelIds: [channel.id],
      dmUnread: { [channel.id]: 0 },
      socialDataReady: true,
    })
    pushMocks.isAppBackgrounded.mockReturnValue(true)
    pushMocks.shouldShowPushNotification.mockReturnValue(true)

    renderAppShell('/social/dm')

    await waitFor(() => {
      expect(apiMocks.listDmChannels).toHaveBeenCalled()
      expect(useAppStore.getState().socialDataReady).toBe(true)
    })

    act(() => {
      useSocketStore.getState().listeners.forEach((listener) => {
        listener({
          type: 'NewMessage',
          data: {
            channel_id: channel.id,
            channel_type: 'dm',
            message: {
              id: 'message-notification',
              created_at: '2026-08-14T12:00:00.000Z',
              author: { user_id: 'friend-1', username: 'friend' },
            },
          },
        })
      })
    })

    await waitFor(() => {
      expect(pushMocks.showPushNotification).toHaveBeenCalledTimes(1)
      expect(useAppStore.getState().dmUnread[channel.id]).toBe(1)
    })

    const notification = pushMocks.showPushNotification.mock.calls[0]?.[0] as { onClick?: () => void }
    act(() => notification.onClick?.())

    await waitFor(() => {
      expect(screen.getByTestId('shell-child')).toHaveAttribute(
        'data-location-state',
        JSON.stringify({
          dmNotificationAnchor: {
            channelId: channel.id,
            messageId: 'message-notification',
            notificationId: 'message-notification',
          },
        }),
      )
    })
    expect(useAppStore.getState().dmUnread[channel.id]).toBe(1)
  })
})
