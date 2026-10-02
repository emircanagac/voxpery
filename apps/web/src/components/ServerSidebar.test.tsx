import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('ServerSidebar reorder', () => {
  const servers = [officialServer, otherServer, { ...otherServer, id: 'third-server', name: 'Third' }]
  const storageKey = 'voxpery-server-order:member-1'
  function dragAt(root: HTMLElement, type: 'dragOver' | 'drop', dataTransfer: object, clientY: number) {
    const event = createEvent[type](root, { dataTransfer })
    Object.defineProperty(event, 'clientY', { value: clientY })
    fireEvent(root, event)
  }
  beforeEach(() => {
    localStorage.clear()
    useAppStore.getState().resetSessionState()
    useAuthStore.setState({ user: { id: 'member-1', username: 'member', email: 'member@example.test', email_verified: true, status: 'online' }, token: 'token' })
    useAppStore.setState({ servers })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  async function setupDrag() {
    const { container } = render(<ServerSidebar onCreateServer={vi.fn()} onJoinServer={vi.fn()} />)
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBe(JSON.stringify(servers.map(s => s.id))))
    const root = container.querySelector<HTMLElement>('.server-sidebar')!
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-server-id]'))
    buttons.forEach((button, index) => {
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 100 + index * 56, height: 48 } as DOMRect)
    })
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() }
    fireEvent.dragStart(buttons[2], { dataTransfer })
    return { root, buttons, dataTransfer }
  }

  it('shows the first insertion slot and moves the last server to the top', async () => {
    const { root, buttons, dataTransfer } = await setupDrag()
    dragAt(root, 'dragOver', dataTransfer, 96)
    expect(buttons[0].parentElement).toHaveClass('drag-over-before')
    dragAt(root, 'drop', dataTransfer, 96)
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(['third-server', 'official-server', 'other-server'])
    expect(root).not.toHaveClass('is-dragging')
  })

  it('keeps the drag alive after leaving and returning to the rail', async () => {
    const { root, buttons, dataTransfer } = await setupDrag()
    dragAt(root, 'dragOver', dataTransfer, 220)
    fireEvent.dragLeave(root, { relatedTarget: document.body })
    expect(root).toHaveClass('is-dragging')
    expect(buttons[1].parentElement).not.toHaveClass('drag-over-after')
    dragAt(root, 'dragOver', dataTransfer, 96)
    dragAt(root, 'drop', dataTransfer, 96)
    expect(JSON.parse(localStorage.getItem(storageKey)!)[0]).toBe('third-server')
  })

  it('uses the actual release position instead of a stale hover target', async () => {
    const { root, dataTransfer } = await setupDrag()
    dragAt(root, 'dragOver', dataTransfer, 220)
    dragAt(root, 'drop', dataTransfer, 96)
    expect(JSON.parse(localStorage.getItem(storageKey)!)[0]).toBe('third-server')
  })

  it('cancels without changing order and ignores external drags', async () => {
    const { root, buttons, dataTransfer } = await setupDrag()
    dragAt(root, 'dragOver', dataTransfer, 96)
    fireEvent.dragEnd(buttons[2])
    expect(root).not.toHaveClass('is-dragging')
    expect(root.querySelector('.drag-over-before')).toBeNull()
    dragAt(root, 'drop', dataTransfer, 96)
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(servers.map(s => s.id))
  })
})
