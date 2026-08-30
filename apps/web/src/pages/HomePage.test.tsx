import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DmChannel, Friend } from '../api'
import { ROUTES } from '../routes'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useToastStore } from '../stores/toast'
import { clearDmMessageCacheForTests, setCachedDmMessages } from '../dmMessageCache'
import {
  flushMessageDrafts,
  resetMessageDraftCacheForTests,
  saveMessageDraft,
} from '../messageDrafts'
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
  default: ({
    loading,
    messages,
    messageInput,
    jumpToMessageId,
    onJumpToMessageHandled,
  }: {
    loading?: boolean
    messages: unknown[]
    messageInput: string
    jumpToMessageId?: string | null
    onJumpToMessageHandled?: () => void
  }) => (
    <div
      data-testid="dm-chat"
      data-loading={String(!!loading)}
      data-message-count={String(messages.length)}
      data-message-input={messageInput}
      data-jump-message-id={jumpToMessageId ?? ''}
    >
      DM chat
      {jumpToMessageId ? (
        <button type="button" onClick={onJumpToMessageHandled}>Complete notification jump</button>
      ) : null}
    </div>
  ),
}))

const backgroundMocks = vi.hoisted(() => ({
  isAppBackgrounded: vi.fn(() => false),
}))

vi.mock('../pushNotifications', () => ({
  isAppBackgrounded: backgroundMocks.isAppBackgrounded,
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

function renderHomePage(initialEntry: InitialEntry = ROUTES.home) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
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
    resetMessageDraftCacheForTests()
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
    backgroundMocks.isAppBackgrounded.mockReturnValue(false)
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

  it('restores the current user draft when a DM is opened', async () => {
    apiMocks.getOrCreateDmChannel.mockResolvedValue(dmChannel('dm-cilo'))
    saveMessageDraft('user-1', 'dm', 'dm-cilo', 'remember this locally')
    flushMessageDrafts()
    resetMessageDraftCacheForTests()

    renderHomePage()
    fireEvent.click(await screen.findByRole('button', { name: 'Message cilo' }))

    await waitFor(() => {
      expect(screen.getByTestId('dm-chat').getAttribute('data-message-input')).toBe('remember this locally')
    })
  })

  it('opens a DM from the friend row', async () => {
    apiMocks.getOrCreateDmChannel.mockResolvedValue(dmChannel('dm-cilo'))

    renderHomePage()

    fireEvent.click(await screen.findByRole('button', { name: 'Message cilo' }))

    await waitFor(() => {
      expect(apiMocks.getOrCreateDmChannel).toHaveBeenCalledWith('friend-cilo', null)
      expect(useAppStore.getState().activeDmChannelId).toBe('dm-cilo')
    })
    expect(screen.getByTestId('dm-chat')).not.toBeNull()
  })

  it('opens the friend context menu from the more-actions button', async () => {
    renderHomePage()

    fireEvent.click(await screen.findByRole('button', { name: 'More actions for cilo' }))

    const menu = screen.getByRole('menu', { name: 'Actions for cilo' })
    expect(menu).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'View profile (@cilo)' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Send message' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Remove friend' })).toBeVisible()
  })

  it('opens a friend profile from the viewport-clamped Social context menu', async () => {
    renderHomePage()

    const friendRow = (await screen.findByRole('button', { name: 'Message cilo' })).closest('.home-member-row')
    expect(friendRow).not.toBeNull()
    fireEvent.contextMenu(friendRow!, { clientX: window.innerWidth + 200, clientY: window.innerHeight + 200 })

    const menu = screen.getByRole('menu', { name: 'Actions for cilo' })
    expect(menu).toBeVisible()
    expect(Number.parseInt(menu.style.left, 10)).toBeLessThan(window.innerWidth)
    expect(Number.parseInt(menu.style.top, 10)).toBeLessThan(window.innerHeight)

    fireEvent.click(screen.getByRole('menuitem', { name: 'View profile (@cilo)' }))
    expect(screen.getByRole('dialog', { name: 'cilo' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send DM' })).toBeVisible()
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

  it('keeps the DM context menu compact and removes the redundant open action', async () => {
    const channel = dmChannel('dm-cilo')
    apiMocks.listDmChannels.mockResolvedValue([channel])

    renderHomePage()

    const dmOpenButton = (await screen.findAllByRole('button', { name: 'Open DM with cilo' }))
      .find((button) => button.classList.contains('social-dm-open'))
    const dmRow = dmOpenButton?.closest('.social-dm-item')
    expect(dmRow).not.toBeNull()
    fireEvent.contextMenu(dmRow!)

    expect(screen.getByRole('menuitem', { name: 'View profile (@cilo)' })).toHaveFocus()
    expect(screen.queryByRole('menuitem', { name: 'Open direct message' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Pin Conversation' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Remove friend' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Close DM' })).toBeVisible()
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

  it('waits for refreshed notification history and visible anchor before clearing unread', async () => {
    const channel = dmChannel('dm-cilo')
    const cached = dmMessage('message-cached', channel.id)
    const target = dmMessage('message-notification', channel.id)
    let resolveMessages!: (messages: ReturnType<typeof dmMessage>[]) => void
    const pendingMessages = new Promise<ReturnType<typeof dmMessage>[]>((resolve) => {
      resolveMessages = resolve
    })
    setCachedDmMessages('user-1', channel.id, [cached])
    useAppStore.setState({
      activeDmChannelId: channel.id,
      dmChannels: [channel],
      dmChannelIds: [channel.id],
      dmUnread: { [channel.id]: 2 },
      socialDataReady: true,
    })
    apiMocks.listDmChannels.mockResolvedValue([channel])
    apiMocks.listDmMessages.mockReturnValue(pendingMessages)

    renderHomePage({
      pathname: ROUTES.dm,
      state: {
        dmNotificationAnchor: {
          channelId: channel.id,
          messageId: target.id,
          notificationId: target.id,
        },
      },
    })

    const chat = await screen.findByTestId('dm-chat')
    expect(chat).toHaveAttribute('data-message-count', '1')
    expect(chat).toHaveAttribute('data-loading', 'true')
    expect(chat).toHaveAttribute('data-jump-message-id', '')
    expect(useAppStore.getState().dmUnread[channel.id]).toBe(2)
    expect(apiMocks.markDmRead).not.toHaveBeenCalled()

    await act(async () => {
      resolveMessages([cached, target])
      await pendingMessages
    })

    await waitFor(() => {
      expect(chat).toHaveAttribute('data-jump-message-id', target.id)
    })
    expect(useAppStore.getState().dmUnread[channel.id]).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Complete notification jump' }))

    await waitFor(() => {
      expect(useAppStore.getState().dmUnread[channel.id]).toBe(0)
      expect(apiMocks.markDmRead).toHaveBeenCalledWith(channel.id, null)
    })
  })

  it('falls back to the refreshed latest message when a notification target is unavailable', async () => {
    const channel = dmChannel('dm-cilo')
    const latest = dmMessage('message-latest', channel.id)
    useAppStore.setState({
      activeDmChannelId: channel.id,
      dmChannels: [channel],
      dmChannelIds: [channel.id],
      dmUnread: { [channel.id]: 1 },
      socialDataReady: true,
    })
    apiMocks.listDmChannels.mockResolvedValue([channel])
    apiMocks.listDmMessages.mockResolvedValue([latest])

    renderHomePage({
      pathname: ROUTES.dm,
      state: {
        dmNotificationAnchor: {
          channelId: channel.id,
          messageId: 'message-missing',
          notificationId: 'message-missing',
        },
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('dm-chat')).toHaveAttribute('data-jump-message-id', latest.id)
    })
    expect(useAppStore.getState().dmUnread[channel.id]).toBe(1)
  })

  it('does not mark the active DM read while the app is backgrounded', async () => {
    const channel = dmChannel('dm-cilo')
    sessionStorage.setItem('voxpery-social-view', 'dm')
    useAppStore.setState({
      activeDmChannelId: channel.id,
      dmChannels: [channel],
      dmChannelIds: [channel.id],
      socialDataReady: true,
    })
    apiMocks.listDmChannels.mockResolvedValue([channel])
    apiMocks.listDmMessages.mockResolvedValue([])
    backgroundMocks.isAppBackgrounded.mockReturnValue(true)

    renderHomePage(ROUTES.dm)
    await waitFor(() => expect(apiMocks.listDmMessages).toHaveBeenCalledWith(channel.id, null))
    useAppStore.setState({ dmUnread: { [channel.id]: 1 } })

    act(() => {
      useSocketStore.getState().listeners.forEach((listener) => {
        listener({
          type: 'NewMessage',
          data: {
            channel_id: channel.id,
            message: dmMessage('message-background', channel.id),
          },
        })
      })
    })

    expect(useAppStore.getState().dmUnread[channel.id]).toBe(1)
    expect(apiMocks.markDmRead).not.toHaveBeenCalled()
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
