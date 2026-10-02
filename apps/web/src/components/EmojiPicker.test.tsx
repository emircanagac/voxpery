import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmojiPicker from './EmojiPicker'

vi.mock('../giphy', () => ({ isGiphyConfigured: () => false, fetchGiphyGifs: vi.fn() }))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('EmojiPicker', () => {
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
    expect(onSelect).toHaveBeenCalledWith('\u{1f600}')
    unmount()
    render(<EmojiPicker onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Recently used' }))
    expect(screen.getByRole('button', { name: 'grinning face' })).toBeVisible()
  })

  it('uses the same browse, recent, and favorites collections for stickers', () => {
    render(<EmojiPicker initialMode="sticker" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Browse' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Recent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Add Party to favorites' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    expect(screen.getByRole('button', { name: 'Send Party' })).toBeVisible()
  })

  it('keeps reaction mode compact and free of media tabs', () => {
    render(<EmojiPicker compact reactionMode onSelect={vi.fn()} />)
    expect(screen.queryByRole('tab', { name: 'GIF' })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search reactions')).toBeVisible()
  })

  it('keeps the initial mode and supports arrow, Home and End tab navigation', () => {
    const onModeChange = vi.fn()
    render(<EmojiPicker initialMode="gif" onSelect={vi.fn()} onModeChange={onModeChange} />)
    const gif = screen.getByRole('tab', { name: 'GIF' })
    const emoji = screen.getByRole('tab', { name: 'Emoji' })
    const sticker = screen.getByRole('tab', { name: 'Sticker' })
    expect(gif).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'GIF' })).toHaveAttribute('id', gif.getAttribute('aria-controls'))
    gif.focus()
    fireEvent.keyDown(gif, { key: 'ArrowRight' })
    expect(sticker).toHaveFocus()
    expect(sticker).toHaveAttribute('aria-selected', 'true')
    expect(onModeChange).toHaveBeenLastCalledWith('sticker')
    fireEvent.keyDown(sticker, { key: 'Home' })
    expect(emoji).toHaveFocus()
    fireEvent.keyDown(emoji, { key: 'End' })
    expect(sticker).toHaveFocus()
    fireEvent.keyDown(sticker, { key: 'ArrowRight' })
    expect(emoji).toHaveFocus()
  })

  it('clears an empty search result without losing input focus', () => {
    render(<EmojiPicker onSelect={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: 'Search emoji' })
    fireEvent.change(input, { target: { value: 'doesnotexist987' } })
    expect(screen.getByText('No emoji found.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: 'grinning face' })).toBeVisible()
  })

  it('reports category and collection selection and leaves reactions emoji-only', () => {
    const onSelect = vi.fn()
    const view = render(<EmojiPicker onSelect={onSelect} reactionMode compact />)
    expect(screen.queryByRole('tablist', { name: 'Expression types' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Smileys' }))
    expect(screen.getByRole('button', { name: 'Smileys' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'grinning face' }))
    expect(onSelect).toHaveBeenCalledOnce()
    view.unmount()
    render(<EmojiPicker initialMode="sticker" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Favorite stickers appear here.')).toBeVisible()
  })

  it('uses lazy media previews and delegates closing to the opener', () => {
    const onClose = vi.fn()
    const view = render(<EmojiPicker initialMode="gif" onSelect={vi.fn()} onClose={onClose} />)
    expect(view.container.querySelector('img')).toHaveAttribute('loading', 'lazy')
    fireEvent.click(screen.getByRole('button', { name: 'Close expression picker' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
