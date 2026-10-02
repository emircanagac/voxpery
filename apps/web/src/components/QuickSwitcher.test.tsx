import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QuickSwitcher, { type QuickSwitcherItem } from './QuickSwitcher'

const items: QuickSwitcherItem[] = [
  { id: 'channel', kind: 'channel', label: 'general', searchText: 'general Guild' },
  { id: 'server', kind: 'server', label: 'Guild', searchText: 'Guild' },
  { id: 'dm', kind: 'dm', label: 'Friend', searchText: 'Friend' },
]

describe('QuickSwitcher groups', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('groups direct messages, servers and channels in the displayed keyboard order', () => {
    const onSelect = vi.fn()
    render(<QuickSwitcher items={items} onClose={vi.fn()} onSelect={onSelect} />)
    expect(screen.getAllByRole('heading').map(el => el.textContent)).toEqual(['Direct messages', 'Servers', 'Channels'])
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(items[1])
  })

  it('keeps the other groups discoverable with many direct messages', () => {
    const dms = Array.from({ length: 20 }, (_, index) => ({ ...items[2], id: `dm-${index}` }))
    render(<QuickSwitcher items={[...dms, ...items.slice(0, 2)]} onClose={vi.fn()} onSelect={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Servers' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Channels' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Direct messages' }).querySelectorAll('button')).toHaveLength(6)
  })

  it('hides empty groups, resets selection after filtering and reports no matches', () => {
    const onSelect = vi.fn()
    render(<QuickSwitcher items={items} onClose={vi.fn()} onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'general' } })
    expect(screen.getAllByRole('heading').map(el => el.textContent)).toEqual(['Channels'])
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(items[0])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } })
    expect(screen.getByText(/No matches/)).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('does not select a result when Enter is used on the close button', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<QuickSwitcher items={items} onClose={onClose} onSelect={onSelect} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close quick switcher' }), { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close quick switcher' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not scroll on pointer selection but keeps keyboard and filtered selections visible', () => {
    render(<QuickSwitcher items={items} onClose={vi.fn()} onSelect={vi.fn()} />)
    const scroll = vi.mocked(HTMLElement.prototype.scrollIntoView)
    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Servers' }).querySelector('button')!)
    expect(scroll).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown' })
    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
    fireEvent.mouseEnter(screen.getByRole('region', { name: 'Direct messages' }).querySelector('button')!)
    expect(scroll).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'general' } })
    expect(scroll).toHaveBeenCalledTimes(2)
  })
})
