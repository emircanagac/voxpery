import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DmFriendPicker from './DmFriendPicker'

const friends = [
  { id: 'a', username: 'alice', avatar_url: null, status: 'online' },
  { id: 'b', username: 'bob', avatar_url: null, status: 'offline' },
  { id: 'c', username: 'carol', avatar_url: null, status: 'online' },
]

describe('DmFriendPicker', () => {
  it('opens a direct message for one friend and a group for several', () => {
    const onSubmit = vi.fn()
    render(<DmFriendPicker mode="new" friends={friends} onSubmit={onSubmit} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Open DM' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'alice' }))
    expect(screen.queryByLabelText('Group name (optional)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open DM' }))
    expect(onSubmit).toHaveBeenLastCalledWith(['a'], '')

    fireEvent.click(screen.getByRole('checkbox', { name: 'carol' }))
    fireEvent.change(screen.getByLabelText('Group name (optional)'), { target: { value: '  Weekend  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    expect(onSubmit).toHaveBeenLastCalledWith(['a', 'c'], 'Weekend')
  })

  it('filters by search and respects the remaining room', () => {
    render(<DmFriendPicker mode="add" friends={friends} excludeIds={['a']} capacity={1} onSubmit={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByRole('checkbox', { name: 'alice' })).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search friends' }), { target: { value: 'CAR' } })
    expect(screen.queryByRole('checkbox', { name: 'bob' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'carol' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search friends' }), { target: { value: '' } })
    expect(screen.getByRole('checkbox', { name: 'bob' })).toBeDisabled()
  })

  it('explains an empty friends list and closes with Escape', () => {
    const onClose = vi.fn()
    render(<DmFriendPicker mode="new" friends={[]} onSubmit={vi.fn()} onClose={onClose} />)

    expect(screen.getByRole('status')).toHaveTextContent('You have no friends yet')
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New message' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
