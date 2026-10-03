import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { handleMenuKeyboardNavigation } from './menuKeyboardNavigation'

function Menu() {
  return <div role="menu" tabIndex={-1} onKeyDown={handleMenuKeyboardNavigation}>
    <button>Profile</button>
    <button disabled>Disabled</button>
    <button aria-disabled="true">Unavailable</button>
    <div hidden><button>Hidden</button></div>
    <div style={{ display: 'none' }}><button>Hidden parent</button></div>
    <button style={{ visibility: 'hidden' }}>Invisible</button>
    <button>Message</button>
    <button>Last</button>
    <input type="range" aria-label="Volume" />
    <select aria-label="Channel"><option>General</option></select>
    <input aria-label="Query" />
    <div contentEditable aria-label="Editable" />
  </div>
}

describe('context-menu keyboard navigation', () => {
  it('moves and wraps in both directions while skipping unavailable and hidden actions', () => {
    render(<Menu />)
    const first = screen.getByRole('button', { name: 'Profile' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Message' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  })

  it('supports Home and End and starts from the container', () => {
    render(<Menu />)
    const menu = screen.getByRole('menu')
    menu.focus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
    menu.focus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveFocus()
  })

  it.each(['Volume', 'Channel', 'Query', 'Editable'])('does not intercept %s control keys', label => {
    render(<Menu />)
    const control = screen.getByLabelText(label)
    control.focus()
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(fireEvent.keyDown(control, { key })).toBe(true)
      expect(control).toHaveFocus()
    }
  })

  it('leaves Tab, Escape, activation and modified shortcuts to existing handlers', () => {
    const bubble = vi.fn()
    render(<div onKeyDown={bubble}><Menu /></div>)
    const first = screen.getByRole('button', { name: 'Profile' })
    first.focus()
    for (const key of ['Tab', 'Escape', 'Enter', ' ']) {
      expect(fireEvent.keyDown(first, { key })).toBe(true)
    }
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(fireEvent.keyDown(first, { key: 'ArrowDown', [modifier]: true })).toBe(true)
      expect(first).toHaveFocus()
    }
    expect(bubble).toHaveBeenCalledTimes(8)
    expect(fireEvent.keyDown(first, { key: 'ArrowDown' })).toBe(false)
    expect(bubble).toHaveBeenCalledTimes(8)
  })

  it('does not consume navigation when no enabled action exists', () => {
    render(<div role="menu" onKeyDown={handleMenuKeyboardNavigation}><button disabled>Only action</button></div>)
    expect(fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })).toBe(true)
  })
})
