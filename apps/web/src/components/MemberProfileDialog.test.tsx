import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MemberProfileDialog from './MemberProfileDialog'

describe('MemberProfileDialog', () => {
  it('traps keyboard focus and closes with Escape', () => {
    const onClose = vi.fn()
    render(<MemberProfileDialog
      member={{ user_id: 'alice', username: 'alice', role: 'member' }}
      isServerOwner={false}
      onClose={onClose}
      actions={{ canSendDm: true, canAddFriend: true, onSendDm: vi.fn(), onAddFriend: vi.fn() }}
    />)
    const close = screen.getByRole('button', { name: 'Close profile' })
    const addFriend = screen.getByRole('button', { name: 'Add friend' })
    expect(close).toHaveFocus()
    addFriend.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(addFriend).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
