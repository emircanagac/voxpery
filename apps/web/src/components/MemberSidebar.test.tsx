import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, Server, User } from '../types'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import MemberSidebar from './MemberSidebar'

const localUser: User = {
  id: 'user-local',
  username: 'cooluser',
  email: 'cooluser@example.test',
  email_verified: true,
  status: 'online',
}

const server: Server = {
  id: 'server-1',
  name: 'Voxpery',
  owner_id: localUser.id,
  invite_code: 'invite',
}

const voiceChannel: Channel = {
  id: 'voice-1',
  server_id: server.id,
  name: 'General',
  channel_type: 'voice',
  position: 0,
}

describe('MemberSidebar profile interaction', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 'token', user: localUser, loggingOut: false })
    useAppStore.setState({
      servers: [server],
      activeServerId: server.id,
      activeChannelId: voiceChannel.id,
      channels: [voiceChannel],
      members: [
        {
          user_id: localUser.id,
          username: localUser.username,
          avatar_url: null,
          role: 'owner',
          status: 'online',
          role_color: null,
        },
        {
          user_id: 'peer-1',
          username: 'admin',
          avatar_url: null,
          about_me: 'Building a thoughtful community.',
          role: 'member',
          status: 'online',
          role_color: null,
          account_created_at: '2025-01-03T12:00:00.000Z',
          server_joined_at: '2025-02-04T12:00:00.000Z',
        },
      ],
      friends: [],
    })
  })

  it('keeps left click inert and opens a centered profile from the context menu', () => {
    const { container } = render(
      <MemoryRouter>
        <MemberSidebar
          canKickMembers={false}
          canBanMembers={false}
          canTimeoutMembers={false}
          canManageRolesFromPerms={false}
        />
      </MemoryRouter>,
    )

    const memberRow = screen.getByText('admin').closest('.member-item')
    expect(memberRow).not.toBeNull()
    const memberSidebar = container.querySelector('.member-sidebar')
    expect(memberSidebar).not.toBeNull()
    vi.spyOn(memberSidebar!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 240,
      height: 800,
      top: 0,
      right: 240,
      bottom: 800,
      left: 0,
      toJSON: () => ({}),
    })

    fireEvent.click(memberRow!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.contextMenu(memberRow!, { clientX: 120, clientY: 80 })
    expect(container.querySelector('.member-context-menu')).toHaveStyle({ left: '32px' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'View profile (@admin)' }))

    expect(screen.getByRole('dialog', { name: 'admin' })).toBeVisible()
    expect(screen.getByText('Building a thoughtful community.')).toBeVisible()
    expect(screen.getByText('Member since')).toBeVisible()
    expect(screen.getByText('Joined server')).toBeVisible()
    expect(screen.queryByText('Server Profile')).not.toBeInTheDocument()
    expect(screen.queryByText('No custom roles.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send DM' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close profile' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
