import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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
  shouldShowPushNotification: vi.fn(() => false),
  showPushNotification: vi.fn(),
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

function renderAppShell() {
  return render(
    <MemoryRouter initialEntries={['/channels/@me']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/channels/@me" element={<div data-testid="shell-child" />} />
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
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000)
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
})
