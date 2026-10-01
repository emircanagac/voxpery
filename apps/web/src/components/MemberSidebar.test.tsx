import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('opens profiles with left click and preserves the context menu', () => {
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

    fireEvent.click(memberRow!)
    expect(screen.getByRole('dialog', { name: 'admin' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close profile' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.contextMenu(memberRow!, { clientX: 120, clientY: 80 })
    const menu = screen.getByRole('menu', { name: 'Actions for admin' })
    expect(menu.parentElement).toBe(document.body)
    expect(memberSidebar).not.toContainElement(menu)
    fireEvent.scroll(menu)
    expect(menu).toBeInTheDocument()
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

  it('opens member actions from the keyboard and restores row focus', () => {
    render(
      <MemoryRouter>
        <MemberSidebar
          canKickMembers={false}
          canBanMembers={false}
          canTimeoutMembers={false}
          canManageRolesFromPerms={false}
        />
      </MemoryRouter>,
    )
    const member = screen.getByRole('button', { name: 'View profile for admin' })
    member.focus()
    fireEvent.keyDown(member, { key: 'ContextMenu' })
    const menu = screen.getByRole('menu', { name: 'Actions for admin' })
    expect(menu.querySelector('button')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(menu).not.toBeInTheDocument()
    expect(member).toHaveFocus()
  })
})
