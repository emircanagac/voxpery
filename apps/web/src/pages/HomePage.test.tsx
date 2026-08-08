import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DmChannel, Friend } from '../api'
import { ROUTES } from '../routes'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useToastStore } from '../stores/toast'
import { clearDmMessageCacheForTests } from '../dmMessageCache'
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
  hideDmChannel: vi.fn(),
  updateDmChannelPreferences: vi.fn(),
  listDmMessages: vi.fn(),
  markDmRead: vi.fn(),
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
    hideChannel: apiMocks.hideDmChannel,
    updateChannelPreferences: apiMocks.updateDmChannelPreferences,
    listMessages: apiMocks.listDmMessages,
    markRead: apiMocks.markDmRead,
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
  default: ({ loading, messages }: { loading?: boolean; messages: unknown[] }) => (
    <div
      data-testid="dm-chat"
      data-loading={String(!!loading)}
      data-message-count={String(messages.length)}
    >
      DM chat
    </div>
  ),
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
    pinned_at: null,
    is_pinned: false,
  }
}

function dmMessage(id: string, channelId: string) {
  return {
    id,
    channel_id: channelId,
    content: 'Cached history',
    created_at: '2026-06-21T12:00:00.000Z',
    author: {
      user_id: 'friend-cilo',
      username: 'cilo',
    },
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
    clearDmMessageCacheForTests()
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
    apiMocks.markDmRead.mockResolvedValue(undefined)
    apiMocks.listDmPins.mockResolvedValue([])
    apiMocks.hideDmChannel.mockResolvedValue(undefined)
    apiMocks.updateDmChannelPreferences.mockResolvedValue({ pinned: true })
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

  it('opens a DM from the friend action button', async () => {
    apiMocks.getOrCreateDmChannel.mockResolvedValue(dmChannel('dm-cilo'))

    renderHomePage()

    fireEvent.click(await screen.findByRole('button', { name: 'Open DM with cilo' }))

    await waitFor(() => {
      expect(apiMocks.getOrCreateDmChannel).toHaveBeenCalledWith('friend-cilo', null)
      expect(useAppStore.getState().activeDmChannelId).toBe('dm-cilo')
    })
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

  it('hides a DM conversation from the sidebar', async () => {
    const channel = dmChannel('dm-cilo')
    apiMocks.listDmChannels.mockResolvedValue([channel])

    renderHomePage()

    fireEvent.click(await screen.findByRole('button', { name: 'Hide DM with cilo' }))

    await waitFor(() => {
      expect(apiMocks.hideDmChannel).toHaveBeenCalledWith(channel.id, null)
      expect(useAppStore.getState().dmChannels).toEqual([])
      expect(useAppStore.getState().dmChannelIds).toEqual([])
    })
    expect(screen.queryByRole('button', { name: 'Hide DM with cilo' })).toBeNull()
  })

  it('pins and unpins a DM using the persisted channel preference endpoint', async () => {
    const older = { ...dmChannel('dm-older', 'friend-older', 'older'), last_message_at: '2026-01-01T00:00:00.000Z' }
    const recent = { ...dmChannel('dm-recent', 'friend-recent', 'recent'), last_message_at: '2026-02-01T00:00:00.000Z' }
    apiMocks.listDmChannels.mockResolvedValue([recent, older])

    renderHomePage()

    const olderDmRow = (await screen.findByRole('button', { name: 'Open DM with older' })).closest('.social-dm-item')
    expect(olderDmRow).not.toBeNull()
    fireEvent.contextMenu(olderDmRow!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin Conversation' }))

    await waitFor(() => {
      expect(apiMocks.updateDmChannelPreferences).toHaveBeenCalledWith(older.id, true, null)
      expect(useAppStore.getState().dmChannels[0]).toMatchObject({ id: older.id, is_pinned: true })
    })

    apiMocks.updateDmChannelPreferences.mockResolvedValue({ pinned: false })
    const pinnedDmRow = screen.getByRole('button', { name: 'Open DM with older' }).closest('.social-dm-item')
    expect(pinnedDmRow).not.toBeNull()
    fireEvent.contextMenu(pinnedDmRow!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Conversation' }))

    await waitFor(() => {
      expect(apiMocks.updateDmChannelPreferences).toHaveBeenLastCalledWith(older.id, false, null)
      expect(useAppStore.getState().dmChannels.map((channel) => channel.id)).toEqual([recent.id, older.id])
    })
  })

  it('shows cached social data without waiting for the server list refresh', async () => {
    const cachedFriend = friend('friend-cached', 'cachedfriend', 'online')
    const cachedDm = dmChannel('dm-cached', cachedFriend.id, cachedFriend.username)
    apiMocks.listServers.mockReturnValue(new Promise(() => {}))
    apiMocks.listFriends.mockResolvedValue([cachedFriend])
    apiMocks.listDmChannels.mockResolvedValue([cachedDm])
    useAppStore.setState({
      friends: [cachedFriend],
      dmChannels: [cachedDm],
      dmChannelIds: [cachedDm.id],
      socialDataReady: true,
    })

    renderHomePage()

    expect(screen.getByRole('button', { name: 'Message cachedfriend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide DM with cachedfriend' })).toBeInTheDocument()
    expect(screen.queryByText('Start your social graph')).toBeNull()
    await waitFor(() => {
      expect(apiMocks.listFriends).toHaveBeenCalled()
      expect(apiMocks.listDmChannels).toHaveBeenCalled()
    })
  })

  it('refreshes the active DM when returning from another app area', async () => {
    const channel = dmChannel('dm-cilo')
    sessionStorage.setItem('voxpery-social-view', 'dm')
    useAppStore.setState({
      activeDmChannelId: channel.id,
      dmChannels: [channel],
      dmChannelIds: [channel.id],
      dmUnread: { [channel.id]: 1 },
    })
    apiMocks.listDmMessages.mockResolvedValue([])

    renderHomePage()

    await waitFor(() => {
      expect(apiMocks.listDmMessages).toHaveBeenCalledWith(channel.id, null)
      expect(useAppStore.getState().dmUnread[channel.id]).toBe(0)
    })
  })

  it('shows a stable loading state until an uncached DM history is ready', async () => {
    const channel = dmChannel('dm-cilo')
    let resolveMessages!: (messages: ReturnType<typeof dmMessage>[]) => void
    const pendingMessages = new Promise<ReturnType<typeof dmMessage>[]>((resolve) => {
      resolveMessages = resolve
    })
    sessionStorage.setItem('voxpery-social-view', 'dm')
    useAppStore.setState({
      activeDmChannelId: channel.id,
      dmChannels: [channel],
      dmChannelIds: [channel.id],
      socialDataReady: true,
    })
    apiMocks.listDmChannels.mockResolvedValue([channel])
    apiMocks.listDmMessages.mockReturnValue(pendingMessages)

    renderHomePage()

    const chat = await screen.findByTestId('dm-chat')
    expect(chat).toHaveAttribute('data-loading', 'true')
    expect(chat).toHaveAttribute('data-message-count', '0')

    await act(async () => {
      resolveMessages([dmMessage('message-1', channel.id)])
      await pendingMessages
    })

    await waitFor(() => {
      expect(chat).toHaveAttribute('data-loading', 'false')
      expect(chat).toHaveAttribute('data-message-count', '1')
    })
  })

  it('prefetches DM history on hover and reuses the in-flight request on open', async () => {
    const channel = dmChannel('dm-cilo')
    let resolveMessages!: (messages: ReturnType<typeof dmMessage>[]) => void
    const pendingMessages = new Promise<ReturnType<typeof dmMessage>[]>((resolve) => {
      resolveMessages = resolve
    })
    useAppStore.setState({
      dmChannels: [channel],
      dmChannelIds: [channel.id],
      socialDataReady: true,
    })
    apiMocks.listDmChannels.mockResolvedValue([channel])
    apiMocks.listDmMessages.mockReturnValue(pendingMessages)

    renderHomePage()

    const dmButton = (await screen.findByText('cilo')).closest('button')
    expect(dmButton).not.toBeNull()
    fireEvent.pointerEnter(dmButton!)
    fireEvent.click(dmButton!)

    await waitFor(() => {
      expect(apiMocks.listDmMessages).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('dm-chat')).toHaveAttribute('data-loading', 'true')
    })

    await act(async () => {
      resolveMessages([dmMessage('message-1', channel.id)])
      await pendingMessages
    })

    await waitFor(() => {
      expect(screen.getByTestId('dm-chat')).toHaveAttribute('data-message-count', '1')
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
