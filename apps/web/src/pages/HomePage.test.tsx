import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DmChannel, Friend } from '../api'
import { ROUTES } from '../routes'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useToastStore } from '../stores/toast'
import HomePage from './HomePage'

const apiMocks = vi.hoisted(() => ({
  listServers: vi.fn(),
  joinServer: vi.fn(),
  listFriends: vi.fn(),
  listFriendRequests: vi.fn(),
  sendFriendRequest: vi.fn(),
  acceptFriendRequest: vi.fn(),
  rejectFriendRequest: vi.fn(),
  removeFriend: vi.fn(),
  listDmChannels: vi.fn(),
  getOrCreateDmChannel: vi.fn(),
  listDmMessages: vi.fn(),
  listDmPins: vi.fn(),
  createWebSocket: vi.fn(),
}))

vi.mock('../api', () => ({
  attachmentApi: {},
  authApi: {
    getMe: vi.fn(),
    logout: vi.fn(),
  },
  createWebSocket: apiMocks.createWebSocket,
  dmApi: {
    listChannels: apiMocks.listDmChannels,
    getOrCreateChannel: apiMocks.getOrCreateDmChannel,
    listMessages: apiMocks.listDmMessages,
    listPins: apiMocks.listDmPins,
    searchMessages: vi.fn(),
    sendMessage: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
  },
  friendApi: {
    list: apiMocks.listFriends,
    requests: apiMocks.listFriendRequests,
    sendRequest: apiMocks.sendFriendRequest,
    acceptRequest: apiMocks.acceptFriendRequest,
    rejectRequest: apiMocks.rejectFriendRequest,
    remove: apiMocks.removeFriend,
  },
  isAuthError: vi.fn(() => false),
  resolveAvatarUrl: (url: string | null) => url,
  serverApi: {
    list: apiMocks.listServers,
    join: apiMocks.joinServer,
  },
}))

vi.mock('../components/ChatArea', () => ({
  default: () => <div data-testid="dm-chat">DM chat</div>,
}))

function friend(id: string, username: string, status: string): Friend {
  return {
    id,
    username,
    avatar_url: null,
    status,
  }
}

function dmChannel(id: string, peerId = 'friend-cilo', peerUsername = 'cilo'): DmChannel {
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

function renderHomePage() {
  return render(
    <MemoryRouter initialEntries={[ROUTES.home]}>
      <Routes>
        <Route path={ROUTES.home} element={<HomePage />} />
        <Route path={ROUTES.dm} element={<HomePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HomePage friends list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.scrollTo = vi.fn()

    useAuthStore.setState({
      token: null,
      user: {
        id: 'user-1',
        username: 'admin',
        email: 'admin@example.test',
        email_verified: true,
        status: 'online',
        dm_privacy: 'friends',
      },
      loggingOut: false,
    })
    useAppStore.getState().resetSessionState()
    useToastStore.setState({ toasts: [] })
    useSocketStore.setState({
      socket: null,
      isConnected: false,
      listeners: new Set(),
      reconnectListeners: new Set(),
    })

    apiMocks.listServers.mockResolvedValue([])
    apiMocks.listFriends.mockResolvedValue([friend('friend-cilo', 'cilo', 'dnd')])
    apiMocks.listFriendRequests.mockResolvedValue({ incoming: [], outgoing: [] })
    apiMocks.listDmChannels.mockResolvedValue([])
    apiMocks.listDmMessages.mockResolvedValue([])
    apiMocks.listDmPins.mockResolvedValue([])
  })

  it('opens a DM when a friend row is selected', async () => {
    apiMocks.getOrCreateDmChannel.mockResolvedValue(dmChannel('dm-cilo'))

    renderHomePage()

    fireEvent.click(await screen.findByRole('button', { name: 'Message cilo' }))

    await waitFor(() => {
      expect(apiMocks.getOrCreateDmChannel).toHaveBeenCalledWith('friend-cilo', null)
      expect(useAppStore.getState().activeDmChannelId).toBe('dm-cilo')
    })
    expect(useAppStore.getState().dmChannels[0]?.id).toBe('dm-cilo')
    expect(screen.getByTestId('dm-chat')).not.toBeNull()
  })

  it('shows a toast when opening a DM fails', async () => {
    apiMocks.getOrCreateDmChannel.mockRejectedValue(new Error('Could not create DM'))

    renderHomePage()

    fireEvent.click(await screen.findByRole('button', { name: 'Message cilo' }))

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        level: 'error',
        title: 'DM failed',
        message: 'Could not create DM',
      })
    })
  })

  it('orders the All friends tab with active friends first', async () => {
    apiMocks.listFriends.mockResolvedValue([
      friend('offline-a', 'Aaron', 'offline'),
      friend('online-z', 'Zed', 'online'),
      friend('dnd-b', 'Bella', 'dnd'),
      friend('offline-c', 'Clara', 'offline'),
      friend('online-a', 'Adam', 'online'),
    ])

    renderHomePage()

    fireEvent.click(await screen.findByRole('button', { name: 'All' }))

    await waitFor(() => {
      const friendRows = screen.getAllByRole('button', { name: /^Message / })
      expect(friendRows.map((row) => row.getAttribute('aria-label'))).toEqual([
        'Message Adam',
        'Message Bella',
        'Message Zed',
        'Message Aaron',
        'Message Clara',
      ])
    })
  })
})
