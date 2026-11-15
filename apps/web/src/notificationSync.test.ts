import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notificationApi, type NotificationState } from './api/notifications'
import {
  countsFromNotificationState,
  loadNotificationState,
  scheduleChannelRead,
  startMuteSync,
} from './notificationSync'
import { useAppStore } from './stores/app'

vi.mock('./api/notifications', () => ({
  notificationApi: {
    getState: vi.fn(),
    markChannelRead: vi.fn(),
    setMutes: vi.fn(),
  },
}))

const emptyState: NotificationState = { channels: [], muted_server_ids: [], muted_channel_ids: [] }

describe('notificationSync', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(notificationApi.getState).mockReset().mockResolvedValue(emptyState)
    vi.mocked(notificationApi.markChannelRead).mockReset().mockResolvedValue({ channel_id: 'c', last_read_at: null })
    vi.mocked(notificationApi.setMutes).mockReset().mockResolvedValue({ muted_server_ids: [], muted_channel_ids: [] })
    useAppStore.setState({
      serverUnreadByChannel: {},
      serverMentionsByChannel: {},
      mutedServerIds: [],
      mutedChannelIds: [],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns the server state into badges with the mute rules of live messages', () => {
    const counts = countsFromNotificationState({
      channels: [
        { channel_id: 'plain', server_id: 's1', unread_count: 4, mention_count: 0 },
        { channel_id: 'mentioned', server_id: 's1', unread_count: 7, mention_count: 2 },
        { channel_id: 'open', server_id: 's1', unread_count: 3, mention_count: 1 },
        { channel_id: 'muted-quiet', server_id: 's1', unread_count: 5, mention_count: 0 },
        { channel_id: 'muted-mention', server_id: 's1', unread_count: 5, mention_count: 1 },
        { channel_id: 'muted-server', server_id: 's2', unread_count: 9, mention_count: 3 },
      ],
      muted_server_ids: ['s2'],
      muted_channel_ids: ['muted-quiet', 'muted-mention'],
    }, 'open')

    expect(counts.unread).toEqual({ plain: 4, mentioned: 7, 'muted-mention': 1 })
    expect(counts.mentions).toEqual({ mentioned: 2, 'muted-mention': 1 })
  })

  it('sends the mutes of this browser up once and then takes the server list', async () => {
    useAppStore.setState({ mutedServerIds: ['local-server'], mutedChannelIds: ['local-channel'], serverUnreadByChannel: { stale: 3 } })
    vi.mocked(notificationApi.getState).mockResolvedValue({
      channels: [{ channel_id: 'c1', server_id: 's1', unread_count: 2, mention_count: 1 }],
      muted_server_ids: ['local-server', 'other-device-server'],
      muted_channel_ids: ['local-channel'],
    })
    const stop = startMuteSync(() => null)

    await loadNotificationState(null, () => null)

    expect(notificationApi.setMutes).toHaveBeenCalledTimes(1)
    expect(notificationApi.setMutes).toHaveBeenCalledWith(
      { server_ids: ['local-server'], channel_ids: ['local-channel'] }, true, null)
    const state = useAppStore.getState()
    expect(state.mutedServerIds).toEqual(['local-server', 'other-device-server'])
    expect(state.serverUnreadByChannel).toEqual({ c1: 2 })
    expect(state.serverMentionsByChannel).toEqual({ c1: 1 })

    // A later load, also for another account in this browser, never sends local mutes again,
    // and applying the server list is not reported back as a change.
    await loadNotificationState(null, () => null)
    expect(notificationApi.setMutes).toHaveBeenCalledTimes(1)
    stop()
  })

  it('reports mute changes made in this window', () => {
    useAppStore.setState({ mutedServerIds: ['s1'], mutedChannelIds: [] })
    const stop = startMuteSync(() => null)

    useAppStore.getState().toggleMutedChannel('c9')
    expect(notificationApi.setMutes).toHaveBeenLastCalledWith({ server_ids: [], channel_ids: ['c9'] }, true, null)
    useAppStore.getState().toggleMutedServer('s1')
    expect(notificationApi.setMutes).toHaveBeenLastCalledWith({ server_ids: ['s1'], channel_ids: [] }, false, null)

    stop()
    useAppStore.getState().toggleMutedChannel('c9')
    expect(notificationApi.setMutes).toHaveBeenCalledTimes(2)
  })

  it('sends one read mark for a burst and keeps the newest message id', () => {
    vi.useFakeTimers()
    scheduleChannelRead('c1', null, 'm1')
    scheduleChannelRead('c1', null, 'm2')
    scheduleChannelRead('c1', null)
    scheduleChannelRead('c2', null)
    expect(notificationApi.markChannelRead).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(notificationApi.markChannelRead).toHaveBeenCalledTimes(2)
    expect(notificationApi.markChannelRead).toHaveBeenCalledWith('c1', 'm2', null)
    expect(notificationApi.markChannelRead).toHaveBeenCalledWith('c2', undefined, null)
  })
})
