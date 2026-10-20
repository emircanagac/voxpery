import { act, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import { useToastStore } from '../stores/toast'
import UnifiedLayout from './UnifiedLayout'

const apiMocks = vi.hoisted(() => ({
  requests: vi.fn(),
}))

vi.mock('../api', () => ({
  friendApi: { requests: apiMocks.requests },
}))

vi.mock('../components/UnifiedSidebar', () => ({
  default: ({ incomingRequestCount }: { incomingRequestCount: number }) => (
    <div data-testid="incoming-count">{incomingRequestCount}</div>
  ),
}))
vi.mock('./HomePage', () => ({ default: () => <div /> }))
vi.mock('./AppLayout', () => ({ default: () => <div /> }))
vi.mock('../notificationSound', () => ({
  playMessageNotificationSound: vi.fn(),
  shouldPlayNotificationSound: vi.fn(() => false),
}))
vi.mock('../pushNotifications', () => ({
  shouldShowPushNotification: vi.fn(() => false),
  showPushNotification: vi.fn(),
}))

describe('UnifiedLayout friend request synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      token: 'token',
      user: {
        id: 'user-local',
        username: 'local',
        email: 'local@example.test',
        email_verified: true,
        status: 'online',
      },
      loggingOut: false,
    })
    useAppStore.getState().resetSessionState()
    useSocketStore.setState({
      socket: null,
      isConnected: true,
      token: 'token',
      shouldReconnect: true,
      listeners: new Set(),
      reconnectListeners: new Set(),
      reconnectAttempt: 0,
      reconnectTimer: null,
      connectionId: 1,
      wasConnectedBefore: true,
    })
    apiMocks.requests.mockResolvedValue({ incoming: [], outgoing: [] })
  })

  it('uses FriendUpdate and reconnect events without six-second polling', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    render(
      <MemoryRouter initialEntries={['/channels/@me']}>
        <UnifiedLayout />
      </MemoryRouter>,
    )

    await waitFor(() => expect(apiMocks.requests).toHaveBeenCalledTimes(1))
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 6_000)

    act(() => {
      useSocketStore.getState().listeners.forEach((listener) => {
        listener({ type: 'FriendUpdate', data: { user_id: 'another-user' } })
      })
    })
    expect(apiMocks.requests).toHaveBeenCalledTimes(1)

    act(() => {
      useSocketStore.getState().listeners.forEach((listener) => {
        listener({ type: 'FriendUpdate', data: { user_id: 'user-local' } })
      })
    })
    await waitFor(() => expect(apiMocks.requests).toHaveBeenCalledTimes(2))

    act(() => {
      useSocketStore.getState().reconnectListeners.forEach((listener) => listener())
    })
    await waitFor(() => expect(apiMocks.requests).toHaveBeenCalledTimes(3))
  })

  it('shows an in-app notice only for friend requests that arrive after the first load', async () => {
    useToastStore.setState({ toasts: [] })
    const request = (id: string) => ({ id, from_user_id: id, to_user_id: 'user-local', username: id })
    apiMocks.requests.mockResolvedValueOnce({ incoming: [request('a')], outgoing: [] })
    render(
      <MemoryRouter initialEntries={['/servers']}>
        <UnifiedLayout />
      </MemoryRouter>,
    )
    await waitFor(() => expect(apiMocks.requests).toHaveBeenCalledTimes(1))
    expect(useToastStore.getState().toasts).toHaveLength(0)

    apiMocks.requests.mockResolvedValueOnce({ incoming: [request('a'), request('b')], outgoing: [] })
    act(() => {
      useSocketStore.getState().listeners.forEach((listener) => {
        listener({ type: 'FriendUpdate', data: { user_id: 'user-local' } })
      })
    })
    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.title)).toEqual(['New friend request']))
  })
})
