import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MessageInlineActions from './MessageInlineActions'

describe('MessageInlineActions', () => {
  it('keeps primary actions available for the message author', () => {
    const onToggleReactionPicker = vi.fn()
    const onReply = vi.fn()
    const onEdit = vi.fn()
    const onDelete = vi.fn()

    render(
      <MessageInlineActions
        messageId="message-1"
        currentUserId="user-1"
        authorUserId="user-1"
        canReact
        onToggleReactionPicker={onToggleReactionPicker}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add reaction' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onToggleReactionPicker).toHaveBeenCalledWith('message-1', expect.any(HTMLButtonElement))
    expect(onReply).toHaveBeenCalledOnce()
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('keeps destructive owner actions hidden for another user message', () => {
    render(
      <MessageInlineActions
        messageId="message-2"
        currentUserId="user-1"
        authorUserId="user-2"
        onReply={vi.fn()}
        onReport={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Reply' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Report' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('keeps the toolbar visible while its reaction picker is open', () => {
    const { container } = render(
      <MessageInlineActions
        messageId="message-3"
        currentUserId="user-1"
        authorUserId="user-2"
        canReact
        onToggleReactionPicker={vi.fn()}
        reactionPickerOpen
      />
    )

    expect(container.querySelector('.message-inline-actions')?.classList.contains('is-visible')).toBe(true)
  })

  it('exposes the same actions through one compact mobile menu', () => {
    const onReply = vi.fn()
    const onDelete = vi.fn()

    render(
      <MessageInlineActions
        messageId="message-4"
        currentUserId="user-1"
        authorUserId="user-1"
        onReply={onReply}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'More message actions' }))
    const menu = screen.getByRole('menu', { name: 'Message actions' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.position).toBe('')
    expect(menu.style.visibility).not.toBe('hidden')
    fireEvent.click(menu.querySelector('button[role="menuitem"]')!)

    expect(onReply).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull()
  })
})
