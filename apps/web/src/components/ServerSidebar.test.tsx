import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from '../types'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import ServerSidebar from './ServerSidebar'

const officialServer: Server = {
  id: 'official-server',
  name: 'Renamed Community',
  owner_id: 'owner-1',
  invite_code: 'voxpery',
}

const otherServer: Server = {
  id: 'other-server',
  name: 'Voxpery',
  owner_id: 'owner-2',
  invite_code: 'different-invite',
}

describe('ServerSidebar leave actions', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().resetSessionState()
    useAuthStore.setState({
      token: 'token',
      user: {
        id: 'member-1',
        username: 'member',
        email: 'member@example.test',
        email_verified: true,
        status: 'online',
      },
      loggingOut: false,
    })
    useAppStore.setState({ servers: [officialServer, otherServer] })
  })

  it('hides Leave Server for the official community even if its name changes', () => {
    render(<ServerSidebar onCreateServer={vi.fn()} onJoinServer={vi.fn()} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Renamed Community' }))

    expect(screen.queryByRole('button', { name: 'Leave Server' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mute Server' })).toBeInTheDocument()
  })

  it('keeps Leave Server for a different server even if it shares the Voxpery name', () => {
    render(<ServerSidebar onCreateServer={vi.fn()} onJoinServer={vi.fn()} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Voxpery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave Server' }))

    expect(screen.getByText(/Are you sure you want to leave/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
