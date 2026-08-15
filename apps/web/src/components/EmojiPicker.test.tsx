import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmojiPicker from './EmojiPicker'

describe('EmojiPicker', () => {
  beforeEach(() => localStorage.clear())

  it('favorites and sends GIFs while retaining a recent collection', () => {
    const onSelect = vi.fn()
    render(<EmojiPicker initialMode="gif" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Celebration to favorites' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    expect(screen.getByRole('button', { name: 'Send Celebration' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Send Celebration' }))
    expect(onSelect).toHaveBeenCalledWith(expect.stringMatching(/^!\[gif\]\(https:\/\//))

    fireEvent.click(screen.getByRole('button', { name: 'Recent' }))
    expect(screen.getByRole('button', { name: 'Send Celebration' })).toBeVisible()
  })

  it('records selected emoji and exposes it through recently used', () => {
    const onSelect = vi.fn()
    const { unmount } = render(<EmojiPicker onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'grinning face' }))
    expect(onSelect).toHaveBeenCalledWith('😀')
    unmount()

    render(<EmojiPicker onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Recently used' }))
    expect(screen.getByRole('button', { name: 'grinning face' })).toBeVisible()
  })

  it('keeps reaction mode compact and free of media tabs', () => {
    render(<EmojiPicker compact reactionMode onSelect={vi.fn()} />)

    expect(screen.queryByRole('tab', { name: 'GIF' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search reactions')).toBeVisible()
  })
})
