import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, Server, User } from '../api'
import { getSocialActivity } from '../socialActivity'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { useSocketStore } from '../stores/socket'
import SocialActivityPanel from './SocialActivityPanel'

const user: User = { id: 'self', username: 'Me', email: 'me@example.test', email_verified: true, status: 'online' }
const server: Server = { id: 'guild', name: 'Guild', owner_id: 'self', invite_code: 'guild' }
const channel: Channel = { id: 'voice', server_id: 'guild', name: 'Lounge', channel_type: 'voice', position: 0, my_permissions: 1025 }

function seed() {
  useAppStore.getState().resetSessionState()
  useAuthStore.setState({ user, token: null })
  useSocketStore.setState({ isConnected: true, connectionId: 7 })
  useAppStore.setState({
    servers: [server], serversLoading: false, socialDataReady: true,
    channelsByServerId: { guild: [channel] },
    friends: [
      { id: 'streamer', username: 'Streamer', avatar_url: '/avatar.png', status: 'online' },
      { id: 'friend', username: 'Friend', avatar_url: null, status: 'dnd' },
    ],
    voiceStates: { streamer: 'voice', friend: 'voice', self: 'voice', stranger: 'voice' },
    voiceStateServerIds: { streamer: 'guild', friend: 'guild', stranger: 'guild' },
    voiceActivityConnectionIds: { streamer: 7, friend: 7, stranger: 7 },
    voiceControls: {
      streamer: { muted: false, deafened: false, serverMuted: false, serverDeafened: false, screenSharing: true, cameraOn: false },
      stranger: { muted: false, deafened: false, serverMuted: false, serverDeafened: false, screenSharing: true, cameraOn: false },
    }, joinedVoiceChannelId: null,
  })
}

function LocationProbe() { return <span data-testid="route">{useLocation().pathname}</span> }
function renderPanel() {
  return render(<MemoryRouter initialEntries={['/social']}><SocialActivityPanel /><LocationProbe /></MemoryRouter>)
}
function read() { return getSocialActivity(useAppStore.getState(), 'self', useSocketStore.getState().connectionId) }

describe('Friend activity visibility', () => {
  beforeEach(seed)

  it('shows active voice friends once, including streamers, never self or other server members', () => {
    expect(read().map(entry => entry.userId)).toEqual(['friend', 'streamer'])
    expect(read()[1]).toMatchObject({ username: 'Streamer', avatarUrl: '/avatar.png', screenSharing: true })
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Friend Activity' })).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Friends in voice' })).getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Screen sharing' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Server streams' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Watch/ })).toBeNull()
  })

  it.each(['missing', 'no-view', 'text', 'wrong-server', 'left-server', 'missing-permissions'])('excludes %s channel activity', kind => {
    if (kind === 'missing') useAppStore.setState({ channelsByServerId: {} })
    if (kind === 'no-view') useAppStore.setState({ channelsByServerId: { guild: [{ ...channel, my_permissions: 1024 }] } })
    if (kind === 'text') useAppStore.setState({ channelsByServerId: { guild: [{ ...channel, channel_type: 'text' }] } })
    if (kind === 'wrong-server') useAppStore.setState({ voiceStateServerIds: { streamer: 'other', friend: 'other' } })
    if (kind === 'left-server') useAppStore.setState({ servers: [] })
    if (kind === 'missing-permissions') useAppStore.setState({ channelsByServerId: { guild: [{ ...channel, my_permissions: undefined }] } })
    expect(read()).toEqual([])
  })

  it.each(['offline', 'invisible'])('never advertises an %s friend, even while sharing', status => {
    useAppStore.setState({ friends: useAppStore.getState().friends.map(friend => ({ ...friend, status })) })
    expect(read()).toEqual([])
  })

  it('excludes removed friends and clears all activity without an account', () => {
    useAppStore.setState({ friends: [] })
    expect(read()).toEqual([])
    expect(getSocialActivity(useAppStore.getState(), undefined, 7)).toEqual([])
  })

  it('drops old connection presence until a current socket snapshot arrives', () => {
    useSocketStore.setState({ connectionId: 8 })
    expect(read()).toEqual([])
    useAppStore.setState({ voiceActivityConnectionIds: { streamer: 8 } })
    expect(read().map(entry => entry.userId)).toEqual(['streamer'])
  })

  it('removes only the sharing marker when a stream ends and removes rows on voice departure', () => {
    renderPanel()
    act(() => useAppStore.getState().setVoiceControl('streamer', false, false, false))
    expect(screen.queryByRole('img', { name: 'Screen sharing' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Friends in voice' })).getAllByRole('button')).toHaveLength(2)
    act(() => useAppStore.setState({ voiceStates: {} }))
    expect(screen.getByText('No friends in voice right now.')).toBeVisible()
  })

  it('falls back to the friend initial if the avatar fails', () => {
    const { container } = renderPanel()
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelectorAll('.social-activity-avatar')[1]).toHaveTextContent('S')
  })
})

describe('Friend activity navigation', () => {
  beforeEach(seed)

  it.each(['Friend', 'Streamer'])('opens %s without joining, switching or subscribing', name => {
    const join = vi.fn()
    Reflect.set(window, '__voxperyJoinVoice', join)
    useAppStore.setState({ joinedVoiceChannelId: 'existing' })
    const controls = useAppStore.getState().voiceControls
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: `Open Lounge, ${name} in voice` }))
    expect(screen.getByTestId('route')).toHaveTextContent('/servers')
    expect(useAppStore.getState()).toMatchObject({ activeServerId: 'guild', activeChannelId: 'voice', joinedVoiceChannelId: 'existing' })
    expect(useAppStore.getState().voiceControls).toBe(controls)
    expect(join).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    Reflect.deleteProperty(window, '__voxperyJoinVoice')
  })

  it('permits view-only navigation without Connect permission or a voice session', () => {
    useAppStore.setState({ channelsByServerId: { guild: [{ ...channel, my_permissions: 1 }] } })
    renderPanel()
    const button = screen.getByRole('button', { name: 'Open Lounge, Streamer in voice' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(useAppStore.getState().joinedVoiceChannelId).toBeNull()
    expect(screen.getByTestId('route')).toHaveTextContent('/servers')
  })

  it('shows disconnected and loading states instead of stale actions', () => {
    useSocketStore.setState({ isConnected: false })
    renderPanel()
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting')
    expect(screen.queryByRole('button')).toBeNull()
    act(() => { useSocketStore.setState({ isConnected: true }); useAppStore.setState({ serversLoading: true }) })
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })
})
